import type pg from "pg";
import { createHash } from "node:crypto";
import { chmod, open, readFile } from "node:fs/promises";
import { z } from "zod";
import { bindTarget, confirmOrigin, consumeSource, designated, inspect, LineageRefused, locateTarget, migrateQuarantined } from "../db/lineage.js";
import { applyPending, JournalRefused, releaseJournal } from "../db/journal.js";
import { libpqConnection, RecoveryRefused, requireMajor, runTool, type PgTools } from "./tools.js";

export type AdmitPoint = "migrated" | "consumed" | "binding";
export type Restored = Readonly<{ sealId: string; locator: string; archiveSha256: string; archiveBytes: number }>;

const physicalSchema = z.strictObject({ system: z.string().regex(/^[0-9]{1,20}$/), database: z.string().regex(/^[0-9]{1,10}$/), major: z.number().int().min(10).max(99) });
const freshSchema = z.strictObject({ schemas: z.number().int(), relations: z.number().int(), functions: z.number().int(), extensions: z.number().int() });

async function physical(pool: pg.Pool): Promise<z.infer<typeof physicalSchema>> {
 return physicalSchema.parse((await pool.query("SELECT (pg_control_system()).system_identifier::text AS system, (SELECT oid FROM pg_database WHERE datname = current_database())::text AS database, current_setting('server_version_num')::integer / 10000 AS major")).rows[0]);
}

async function distinct(source: pg.Pool, target: pg.Pool): Promise<number> {
 const [left, right] = await Promise.all([physical(source), physical(target)]);
 if (left.system === right.system && left.database === right.database) throw new RecoveryRefused("same-database");
 return Math.max(left.major, right.major);
}

async function fresh(target: pg.Pool): Promise<boolean> {
 const counts = freshSchema.parse((await target.query("SELECT (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('public', 'information_schema') AND nspname NOT LIKE 'pg\\_%')::integer AS schemas, (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public')::integer AS relations, (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public')::integer AS functions, (SELECT count(*) FROM pg_extension WHERE extname <> 'plpgsql')::integer AS extensions")).rows[0]);
 return counts.schemas === 0 && counts.relations === 0 && counts.functions === 0 && counts.extensions === 0;
}

async function reserve(archive: string): Promise<void> {
 try {
  const handle = await open(archive, "wx", 0o600);
  await handle.close();
 } catch (error) {
  if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new RecoveryRefused("archive-exists");
  throw error;
 }
}

export async function restore(o: Readonly<{ source: pg.Pool; sourceUrl: string; target: pg.Pool; targetUrl: string; archive: string; tools: PgTools }>): Promise<Restored> {
 const source = libpqConnection(o.sourceUrl), target = libpqConnection(o.targetUrl);
 requireMajor(o.tools, await distinct(o.source, o.target));
 const state = await inspect(o.source);
 if (state.kind !== "sealed") throw new RecoveryRefused("source-not-sealed", { state: state.kind === "unadmitted" ? state.reason : state.kind });
 if (state.consumedBy !== null) throw new RecoveryRefused("consumed");
 if (!await fresh(o.target)) throw new RecoveryRefused("target-not-fresh");
 await reserve(o.archive);
 await runTool(o.tools, "dump", ["--format=custom", "--no-password", "--file=" + o.archive, "--dbname=" + source.dbname], source.password);
 await chmod(o.archive, 0o600);
 await runTool(o.tools, "restore", ["--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges", "--no-password", "--dbname=" + target.dbname, o.archive], target.password);
 const located = await locateTarget(o.target);
 if (located.kind !== "quarantined" || located.target.sealId !== state.sealId) throw new RecoveryRefused("archive-not-sealed");
 const bytes = await readFile(o.archive);
 return { sealId: state.sealId, locator: located.target.locator, archiveSha256: createHash("sha256").update(bytes).digest("hex"), archiveBytes: bytes.length };
}

function sqlState(error: unknown): string {
 return error instanceof Error && "code" in error && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : "none";
}

export async function admitTarget(o: Readonly<{ source: pg.Pool; target: pg.Pool; migrations: string; pause?: (point: AdmitPoint) => Promise<void> }>): Promise<"admitted" | "already-admitted"> {
 const pause = o.pause ?? (async () => undefined);
 await distinct(o.source, o.target);
 const located = await locateTarget(o.target);
 if (located.kind === "refused") throw new LineageRefused(located.reason);
 if (located.kind === "admitted") return confirmOrigin(o.source, located.origin, located.originSeal);
 const target = located.target;
 const release = await releaseJournal(o.migrations);
 await designated(o.source, target, false);
 try {
  await migrateQuarantined(target, client => applyPending(client, release));
 } catch (error) {
  if (error instanceof LineageRefused) throw error;
  if (error instanceof JournalRefused) throw new RecoveryRefused("migration-failed", { journal: error.status });
  throw new RecoveryRefused("migration-failed", { sqlstate: sqlState(error) });
 }
 await pause("migrated");
 await consumeSource(o.source, target);
 await pause("consumed");
 return bindTarget(target, o.source, pause);
}
