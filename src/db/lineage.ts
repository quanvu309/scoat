import type pg from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { installedJournal, type InstalledJournal, type ReleaseJournal } from "./journal.js";

export const lineageSchemaHead = "0004_lineage";
export type AdmissionRole = "server" | "worker";
export type UnadmittedReason = "schema-behind" | "schema-ahead" | "absent" | "populated-without-lineage" | "identity-mismatch" | "identity-unavailable";
export type HandoffReason = "archive-not-sealed" | "same-database" | "source-not-sealed" | "seal-mismatch" | "not-designated" | "target-changed" | "not-a-recovery-target" | "origin-mismatch";
export type RefusalReason = UnadmittedReason | "sealed" | "consumed" | "not-sealed" | "capability-scope" | HandoffReason;
export type LineageIdentity = Readonly<{ systemIdentifier: string; timeline: string; databaseOid: string; tableOid: string; rowXmin: string }>;
export type LineageState =
 | Readonly<{ kind: "admitted"; identity: LineageIdentity; schema: string }>
 | Readonly<{ kind: "sealed"; sealId: string; consumedBy: string | null; identity: LineageIdentity; schema: string }>
 | Readonly<{ kind: "unadmitted"; reason: UnadmittedReason }>;

export class LineageRefused extends Error {
 constructor(readonly reason: RefusalReason) { super("Lineage refused: " + reason); }
}

const component = z.string().regex(/^(0|[1-9][0-9]{0,19})$/);
const identitySchema = z.string().max(120).transform(value => value.split(":")).pipe(z.tuple([component, component, component, component, component])).transform(([systemIdentifier, timeline, databaseOid, tableOid, rowXmin]): LineageIdentity => ({ systemIdentifier, timeline, databaseOid, tableOid, rowXmin }));
const rowSchema = z.strictObject({
 state: z.enum(["admitted", "sealed"]),
 seal_id: z.uuid().nullable(),
 consumed_by: z.string().min(1).max(200).nullable(),
 identity: identitySchema,
 current: identitySchema,
 schema_head: z.string().min(1).max(64),
 schema: z.string().min(1).max(63),
});
const targetSchema = z.strictObject({
 state: z.enum(["admitted", "sealed"]),
 seal_id: z.uuid().nullable(),
 identity: identitySchema,
 current: identitySchema,
 origin: z.string().min(1).max(200).nullable(),
 origin_seal: z.uuid().nullable(),
});
const pristineSchema = z.strictObject({ pristine: z.boolean() });
const unavailableCodes = new Set(["42501", "55000"]);
const missingCodes = new Set(["42P01", "42883"]);

function sqlState(error: unknown): string | null {
 return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : null;
}

function sameIdentity(left: LineageIdentity, right: LineageIdentity): boolean {
 return left.systemIdentifier === right.systemIdentifier && left.timeline === right.timeline && left.databaseOid === right.databaseOid && left.tableOid === right.tableOid && left.rowXmin === right.rowXmin;
}

function locatorOf(identity: LineageIdentity): string {
 return [identity.systemIdentifier, identity.timeline, identity.databaseOid, identity.tableOid, identity.rowXmin].join(":");
}

function scopeOf(identity: LineageIdentity, schema: string): string {
 return [identity.systemIdentifier, identity.databaseOid, identity.tableOid, schema].join(":");
}

export async function inspect(client: Pick<pg.PoolClient, "query">): Promise<LineageState> {
 let rows: unknown[];
 try {
  rows = (await client.query("SELECT state, seal_id, consumed_by, identity, schema_head, scoat_lineage_identity(xmin::text::numeric) AS current, current_schema() AS schema FROM scoat_lineage")).rows;
 } catch (error) {
  const code = sqlState(error);
  if (code !== null && missingCodes.has(code)) return { kind: "unadmitted", reason: "schema-behind" };
  if (code !== null && unavailableCodes.has(code)) return { kind: "unadmitted", reason: "identity-unavailable" };
  throw error;
 }
 const [first] = rows;
 if (first === undefined) {
  const { pristine } = pristineSchema.parse((await client.query("SELECT scoat_lineage_pristine() AS pristine")).rows[0]);
  return { kind: "unadmitted", reason: pristine ? "absent" : "populated-without-lineage" };
 }
 const row = rowSchema.parse(first);
 if (row.schema_head !== lineageSchemaHead) return { kind: "unadmitted", reason: "schema-ahead" };
 if (!sameIdentity(row.identity, row.current)) return { kind: "unadmitted", reason: "identity-mismatch" };
 if (row.state === "admitted") return { kind: "admitted", identity: row.current, schema: row.schema };
 if (row.seal_id === null) throw new Error("Sealed lineage without a seal id");
 return { kind: "sealed", sealId: row.seal_id, consumedBy: row.consumed_by, identity: row.current, schema: row.schema };
}

export type Observation =
 | Readonly<{ database: "unavailable" }>
 | Readonly<{ database: "available"; journal: InstalledJournal | null; lineage: "admitted" | "sealed" | "consumed" | UnadmittedReason }>;

export async function observe(pool: pg.Pool, release: ReleaseJournal | null): Promise<Observation> {
 let client: pg.PoolClient;
 try {
  client = await pool.connect();
 } catch {
  return { database: "unavailable" };
 }
 try {
  const state = await inspect(client);
  const journal = release === null ? null : await installedJournal(client, release);
  if (state.kind === "admitted") return { database: "available", journal, lineage: "admitted" };
  if (state.kind === "sealed") return { database: "available", journal, lineage: state.consumedBy === null ? "sealed" : "consumed" };
  return { database: "available", journal, lineage: state.reason };
 } catch {
  return { database: "unavailable" };
 } finally {
  client.release();
 }
}

function refusalOf(state: LineageState): RefusalReason {
 if (state.kind === "unadmitted") return state.reason;
 if (state.kind === "sealed") return state.consumedBy === null ? "sealed" : "consumed";
 return "not-sealed";
}

let mint: (role: AdmissionRole, pool: pg.Pool, scope: string) => Admitted;

export class Admitted {
 readonly #scope: string;
 private constructor(readonly role: AdmissionRole, readonly pool: pg.Pool, scope: string) { this.#scope = scope; }
 static {
  mint = (role, pool, scope) => new Admitted(role, pool, scope);
 }
 static scopeOf(admitted: Admitted): string { return admitted.#scope; }
}

export async function admit(pool: pg.Pool, role: AdmissionRole): Promise<Admitted> {
 const client = await pool.connect();
 try {
  const state = await inspect(client);
  if (state.kind !== "admitted") throw new LineageRefused(refusalOf(state));
  return mint(role, pool, scopeOf(state.identity, state.schema));
 } finally { client.release(); }
}

export async function confirm(client: Pick<pg.PoolClient, "query">, admitted: Admitted): Promise<void> {
 const state = await inspect(client);
 if (state.kind !== "admitted") throw new LineageRefused(refusalOf(state));
 if (scopeOf(state.identity, state.schema) !== Admitted.scopeOf(admitted)) throw new LineageRefused("capability-scope");
}

export async function begin(client: pg.PoolClient): Promise<void> {
 await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
 await client.query("SELECT pg_advisory_xact_lock_shared(80109, hashtext(current_schema()))");
 const state = await inspect(client);
 if (state.kind !== "admitted") throw new LineageRefused(refusalOf(state));
}

async function exclusive<T>(pool: pg.Pool, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
 const client = await pool.connect();
 try {
  await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  await client.query("SELECT pg_advisory_xact_lock(80109, hashtext(current_schema()))");
  const result = await run(client);
  await client.query("COMMIT");
  return result;
 } catch (error) {
  await client.query("ROLLBACK");
  throw error;
 } finally { client.release(); }
}

const presentSchema = z.strictObject({ present: z.boolean() });

async function requireAdmitted(client: pg.PoolClient): Promise<void> {
 const state = await inspect(client);
 if (state.kind !== "admitted") throw new LineageRefused(refusalOf(state));
}

export async function migrateAdmitted<T>(pool: pg.Pool, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
 return exclusive(pool, async client => {
  const { present } = presentSchema.parse((await client.query("SELECT to_regclass(quote_ident(current_schema()) || '.scoat_lineage') IS NOT NULL AS present")).rows[0]);
  if (present) await requireAdmitted(client);
  const result = await run(client);
  await requireAdmitted(client);
  return result;
 });
}

export async function seal(pool: pg.Pool): Promise<Readonly<{ sealId: string }>> {
 return exclusive(pool, async client => {
  const sealId = randomUUID();
  const sealed = await client.query("UPDATE scoat_lineage SET state='sealed', seal_id=$1, consumed_by=NULL, identity=scoat_lineage_identity(pg_current_xact_id()::text::numeric % 4294967296), changed_at=clock_timestamp() WHERE state='admitted' AND schema_head=$2 AND identity=scoat_lineage_identity(xmin::text::numeric)", [sealId, lineageSchemaHead]);
  if (sealed.rowCount !== 1) throw new LineageRefused(refusalOf(await inspect(client)));
  return { sealId };
 });
}

export async function unseal(pool: pg.Pool, sealId: string): Promise<"unsealed"> {
 const id = z.uuid().parse(sealId);
 return exclusive(pool, async client => {
  const reopened = await client.query("UPDATE scoat_lineage SET state='admitted', seal_id=NULL, consumed_by=NULL, identity=scoat_lineage_identity(pg_current_xact_id()::text::numeric % 4294967296), changed_at=clock_timestamp() WHERE state='sealed' AND seal_id=$1 AND consumed_by IS NULL AND identity=scoat_lineage_identity(xmin::text::numeric)", [id]);
  if (reopened.rowCount !== 1) throw new LineageRefused(refusalOf(await inspect(client)));
  return "unsealed" as const;
 });
}

let quarantine: (pool: pg.Pool, sealId: string, locator: string) => QuarantinedTarget;

export class QuarantinedTarget {
 readonly #sealId: string;
 readonly #locator: string;
 private constructor(readonly pool: pg.Pool, sealId: string, locator: string) { this.#sealId = sealId; this.#locator = locator; }
 static {
  quarantine = (pool, sealId, locator) => new QuarantinedTarget(pool, sealId, locator);
 }
 get sealId(): string { return this.#sealId; }
 get locator(): string { return this.#locator; }
}

export type TargetState =
 | Readonly<{ kind: "quarantined"; target: QuarantinedTarget }>
 | Readonly<{ kind: "admitted"; origin: string | null; originSeal: string | null }>
 | Readonly<{ kind: "refused"; reason: RefusalReason }>;

export async function locateTarget(pool: pg.Pool): Promise<TargetState> {
 let rows: unknown[];
 try {
  rows = (await pool.query("SELECT state, seal_id, identity, scoat_lineage_identity(xmin::text::numeric) AS current, origin, origin_seal FROM scoat_lineage")).rows;
 } catch (error) {
  const code = sqlState(error);
  if (code !== null && missingCodes.has(code)) return { kind: "refused", reason: "archive-not-sealed" };
  if (code !== null && unavailableCodes.has(code)) return { kind: "refused", reason: "identity-unavailable" };
  throw error;
 }
 const [first] = rows;
 if (first === undefined) return { kind: "refused", reason: "archive-not-sealed" };
 const row = targetSchema.parse(first);
 const genuine = sameIdentity(row.identity, row.current);
 if (genuine && row.state === "admitted") return { kind: "admitted", origin: row.origin, originSeal: row.origin_seal };
 if (genuine) return { kind: "refused", reason: "same-database" };
 if (row.state === "admitted" || row.seal_id === null) return { kind: "refused", reason: "archive-not-sealed" };
 return { kind: "quarantined", target: quarantine(pool, row.seal_id, locatorOf(row.current)) };
}

function sourceRefusal(state: LineageState, target: QuarantinedTarget): RefusalReason {
 if (state.kind === "unadmitted") return state.reason;
 if (state.kind === "admitted") return "source-not-sealed";
 if (state.sealId !== target.sealId) return "seal-mismatch";
 if (state.consumedBy !== null && state.consumedBy !== target.locator) return "consumed";
 return "not-designated";
}

export async function designated(source: pg.Pool, target: QuarantinedTarget, consumed: boolean): Promise<void> {
 const state = await inspect(source);
 const assigned = state.kind === "sealed" && state.sealId === target.sealId && (state.consumedBy === target.locator || (!consumed && state.consumedBy === null));
 if (!assigned) throw new LineageRefused(sourceRefusal(state, target));
}

export async function confirmOrigin(source: pg.Pool, origin: string | null, originSeal: string | null): Promise<"already-admitted"> {
 if (origin === null || originSeal === null) throw new LineageRefused("not-a-recovery-target");
 const state = await inspect(source);
 if (state.kind !== "sealed" || state.sealId !== originSeal || state.consumedBy !== origin) throw new LineageRefused("origin-mismatch");
 return "already-admitted";
}

export async function migrateQuarantined<T>(target: QuarantinedTarget, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
 return exclusive(target.pool, async client => {
  const quarantined = "SELECT 1 FROM scoat_lineage WHERE state='sealed' AND seal_id=$1 AND scoat_lineage_identity(xmin::text::numeric)=$2 AND identity<>$2";
  if ((await client.query(quarantined, [target.sealId, target.locator])).rowCount !== 1) throw new LineageRefused("target-changed");
  const result = await run(client);
  if ((await client.query(quarantined, [target.sealId, target.locator])).rowCount !== 1) throw new LineageRefused("target-changed");
  return result;
 });
}

export async function consumeSource(source: pg.Pool, target: QuarantinedTarget): Promise<"consumed"> {
 return exclusive(source, async client => {
  const consumed = await client.query("UPDATE scoat_lineage SET consumed_by=$2, identity=scoat_lineage_identity(pg_current_xact_id()::text::numeric % 4294967296), changed_at=clock_timestamp() WHERE state='sealed' AND seal_id=$1 AND (consumed_by IS NULL OR consumed_by=$2) AND identity=scoat_lineage_identity(xmin::text::numeric)", [target.sealId, target.locator]);
  if (consumed.rowCount !== 1) throw new LineageRefused(sourceRefusal(await inspect(client), target));
  return "consumed" as const;
 });
}

export async function bindTarget(target: QuarantinedTarget, source: pg.Pool, pause: (point: "binding") => Promise<void>): Promise<"admitted"> {
 return exclusive(target.pool, async client => {
  await designated(source, target, true);
  const bound = await client.query("UPDATE scoat_lineage SET state='admitted', seal_id=NULL, consumed_by=NULL, origin=$2, origin_seal=$1, schema_head=$3, identity=scoat_lineage_identity(pg_current_xact_id()::text::numeric % 4294967296), changed_at=clock_timestamp() WHERE state='sealed' AND seal_id=$1 AND scoat_lineage_identity(xmin::text::numeric)=$2", [target.sealId, target.locator, lineageSchemaHead]);
  if (bound.rowCount !== 1) throw new LineageRefused("target-changed");
  await pause("binding");
  return "admitted" as const;
 });
}
