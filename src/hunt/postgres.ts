import { readDeclaredProfile } from "../memory/storage.js";
import { releaseSchema } from "../knowledge/index.js";
import pg from "pg";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { AccountId, AccountScope, Compatibility, HuntId, Offer, RequestKey, RowId } from "../domain.js";
import type { HuntRecord, RowRecord } from "./store.js";
import type { HuntView } from "./index.js";
import type { Release } from "../knowledge/index.js";

type PersonReceiptKey = z.core.$brand<"PersonReceiptKey"> & string;
export type FenceMode = "shared" | "exclusive";
export type Scope = AccountScope & { hunt: HuntId | null; accountFence: FenceMode; huntFence: FenceMode; rows: readonly RowId[]; request?: { key: RequestKey | PersonReceiptKey; digest: string } };
export type Snapshot = { hunt: HuntRecord; release: Release; rows: RowRecord[]; offers: Offer[]; compatibility: Compatibility[]; final: HuntView | null };
export class StoreFailure extends Error { constructor(readonly code: "forbidden" | "missing" | "key-reused", message: string) { super(message); } }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([k,v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  return JSON.stringify(value);
}
export const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export class Tx {
  readonly prefix: string[];
  replay: unknown = null;
  constructor(readonly client: pg.PoolClient, readonly scope: Scope) { this.prefix = [scope.account, scope.incarnation]; }
  async databaseTime() {
    const milliseconds=z.coerce.number().parse((await this.client.query("SELECT extract(epoch FROM clock_timestamp())*1000 AS milliseconds")).rows[0]?.milliseconds);
    return {milliseconds,instant:z.iso.datetime().brand<"UtcInstant">().parse(new Date(milliseconds).toISOString())};
  }
  async declaredProfile() { return readDeclaredProfile(this.client,this.scope); }
  async snapshot(id: HuntId): Promise<Snapshot | null> {
    const result = await this.client.query("SELECT jsonb_build_object('hunt',h.data,'release',h.release,'final',h.snapshot, 'rows',COALESCE((SELECT jsonb_agg(r.data ORDER BY r.id) FROM hunt_rows r WHERE (r.account,r.incarnation,r.hunt)=(h.account,h.incarnation,h.id)),'[]'), 'offers',COALESCE((SELECT jsonb_agg(o.data ORDER BY o.id) FROM hunt_offers o WHERE (o.account,o.incarnation,o.hunt)=(h.account,h.incarnation,h.id)),'[]'), 'compatibility',COALESCE((SELECT jsonb_agg(c.data ORDER BY c.id) FROM hunt_compatibility c WHERE (c.account,c.incarnation,c.hunt)=(h.account,h.incarnation,h.id)),'[]')) AS value FROM durable_hunts h WHERE account=$1 AND incarnation=$2 AND id=$3", [...this.prefix,id]);
    return result.rows[0]?.value ?? null;
  }
  async priorReceipt(request: { key: RequestKey | PersonReceiptKey; digest: string }): Promise<unknown | null> {
    const row = (await this.client.query("SELECT digest,reply FROM hunt_receipts WHERE account=$1 AND incarnation=$2 AND key=$3", [...this.prefix,request.key])).rows[0];
    if (row && row.digest !== request.digest) throw new StoreFailure("key-reused", "Request key has different payload");
    return row?.reply === undefined || row.reply === null ? null : JSON.parse(row.reply);
  }
  async create(hunt: HuntRecord, release: Release, rows: readonly RowRecord[]) {
    await this.client.query("INSERT INTO durable_hunts(account,incarnation,id,data,release) VALUES($1,$2,$3,$4,$5)", [...this.prefix,hunt.id,hunt,release]);
    for (const row of rows) await this.client.query("INSERT INTO hunt_rows(account,incarnation,hunt,id,data) VALUES($1,$2,$3,$4,$5)", [...this.prefix,hunt.id,row.row,row]);
  }
  async putRow(row: RowRecord) { await this.client.query("UPDATE hunt_rows SET data=$5 WHERE account=$1 AND incarnation=$2 AND hunt=$3 AND id=$4", [...this.prefix,row.hunt,row.row,row]); }
  async replaceOffers(hunt: HuntId, row: RowId, slot: number, offers: readonly Offer[]) {
    await this.client.query("DELETE FROM hunt_compatibility c WHERE c.account=$1 AND c.incarnation=$2 AND c.hunt=$3 AND EXISTS (SELECT 1 FROM hunt_compatibility_members m JOIN hunt_offers o ON (o.account,o.incarnation,o.hunt,o.id)=(m.account,m.incarnation,m.hunt,m.offer) WHERE (m.account,m.incarnation,m.hunt,m.compatibility)=(c.account,c.incarnation,c.hunt,c.id) AND o.row_id=$4 AND o.slot=$5)", [...this.prefix,hunt,row,slot]);
    await this.client.query("DELETE FROM hunt_offers WHERE account=$1 AND incarnation=$2 AND hunt=$3 AND row_id=$4 AND slot=$5", [...this.prefix,hunt,row,slot]);
    for (const offer of offers) await this.client.query("INSERT INTO hunt_offers(account,incarnation,hunt,row_id,slot,id,data) VALUES($1,$2,$3,$4,$5,$6,$7)", [...this.prefix,hunt,row,slot,offer.id,offer]);
  }
  async compatible(hunt: HuntId, evidence: Compatibility) {
    const id = randomUUID();
    await this.client.query("INSERT INTO hunt_compatibility(account,incarnation,hunt,id,data) VALUES($1,$2,$3,$4,$5)", [...this.prefix,hunt,id,evidence]);
    for (const offer of evidence.offers) await this.client.query("INSERT INTO hunt_compatibility_members VALUES($1,$2,$3,$4,$5)", [...this.prefix,hunt,id,offer]);
  }
  async putHunt(hunt: HuntRecord, final: HuntView | null = null) { await this.client.query("UPDATE durable_hunts SET data=$4,snapshot=$5 WHERE account=$1 AND incarnation=$2 AND id=$3", [...this.prefix,hunt.id,hunt,final]); }
  async receipt(reply: unknown) {
    if (this.scope.request) await this.client.query("UPDATE hunt_receipts SET reply=$4 WHERE account=$1 AND incarnation=$2 AND key=$3", [...this.prefix,this.scope.request.key,JSON.stringify(reply)]);
  }
  async ids(after = "", limit = 20): Promise<HuntId[]> { return (await this.client.query("SELECT id FROM durable_hunts WHERE account=$1 AND incarnation=$2 AND id>$3 ORDER BY id LIMIT $4", [...this.prefix,after,limit])).rows.map(r => r.id); }

}
export type Hooks = { beforeAccountFence?: (scope: Scope, client: pg.PoolClient) => Promise<void>; afterAccountFence?: (scope: Scope, client: pg.PoolClient) => Promise<void>; afterRowFence?: (scope: Scope, client: pg.PoolClient) => Promise<void>; beforeCommit?: (scope: Scope, client: pg.PoolClient) => Promise<void> };
export class PostgresHuntStore {
  readonly pool: pg.Pool;
  retries = 0;
  constructor(args: { databaseUrl: string; hooks?: Hooks }) { this.pool = new pg.Pool({ connectionString: args.databaseUrl, max: 16, connectionTimeoutMillis: 5000 }); this.hooks = args.hooks; }
  readonly hooks: Hooks | undefined;
  async createAccount(account: AccountId): Promise<AccountScope> {
    z.string().trim().min(1).max(128).parse(account);
    const incarnation = z.uuid().brand<"Incarnation">().parse(randomUUID());
    await this.pool.query("INSERT INTO hunt_accounts(account,incarnation) VALUES($1,$2)", [account,incarnation]);
    return { account,incarnation };
  }
  async close() { await this.pool.end(); }
  async transact<T>(scope: Scope, run: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt=0; ;attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        await this.hooks?.beforeAccountFence?.(scope,client);
        const account = await client.query("SELECT erased FROM hunt_accounts WHERE account=$1 AND incarnation=$2 FOR " + (scope.accountFence === "exclusive" ? "UPDATE" : "SHARE"), [scope.account,scope.incarnation]);
        if (!account.rows[0] || account.rows[0].erased) throw new StoreFailure("forbidden", "Inactive account incarnation");
        await this.hooks?.afterAccountFence?.(scope,client);
        if (scope.hunt !== null) {
          const hunt = await client.query("SELECT id FROM durable_hunts WHERE account=$1 AND incarnation=$2 AND id=$3 FOR " + (scope.huntFence === "exclusive" ? "UPDATE" : "SHARE"), [scope.account,scope.incarnation,scope.hunt]);
          if (!hunt.rowCount) throw new StoreFailure("missing", "Hunt unavailable");
        }
        const tx = new Tx(client,scope);
        if (scope.request) {
          await client.query("INSERT INTO hunt_receipts(account,incarnation,key,digest) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [scope.account,scope.incarnation,scope.request.key,scope.request.digest]);
          const receipt = (await client.query("SELECT digest,reply FROM hunt_receipts WHERE account=$1 AND incarnation=$2 AND key=$3 FOR UPDATE", [scope.account,scope.incarnation,scope.request.key])).rows[0];
          if (receipt.digest !== scope.request.digest) throw new StoreFailure("key-reused", "Request key has different payload");
          tx.replay = receipt.reply === null ? null : JSON.parse(receipt.reply);
        }
        for (const row of [...new Set(scope.rows)].sort()) await client.query("SELECT id FROM hunt_rows WHERE account=$1 AND incarnation=$2 AND hunt=$3 AND id=$4 FOR UPDATE", [scope.account,scope.incarnation,scope.hunt,row]);
        await this.hooks?.afterRowFence?.(scope,client);
        const result = tx.replay !== null ? tx.replay as T : await run(tx);
        await this.hooks?.beforeCommit?.(scope,client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        if (error instanceof Error && "code" in error && ["40001","40P01"].includes(String(error.code)) && attempt < 2) { this.retries++; continue; }
        throw error;
      } finally { client.release(); }
    }
  }
}

export async function readFinishedResult(client: pg.PoolClient, scope: AccountScope, hunt: string) {
 const row = (await client.query("SELECT snapshot,release FROM durable_hunts WHERE account=$1 AND incarnation=$2 AND id=$3 FOR SHARE",[scope.account,scope.incarnation,hunt])).rows[0];
 if (!row || row.snapshot === null) return null;
 const snapshot = z.json().parse(row.snapshot);
 const envelope = z.object({ hunt: z.string(), release: z.string(), text: z.string(), profile: z.object({ student: z.enum(["yes","no","unknown"]), cards: z.array(z.string()), memberships: z.array(z.string()) }), final: z.object({ kind: z.literal("finished") }) }).parse(snapshot);
 const release = releaseSchema.parse(row.release);
 if (envelope.hunt !== hunt || envelope.release !== release.id) throw new Error("Invalid finished result persistence");
 return { snapshot,release };
}
export async function deleteHunts(client: pg.PoolClient, scope: AccountScope) {
 const counts: Record<string,number> = {};
 for (const table of ["hunt_compatibility_members","hunt_compatibility","hunt_offers","hunt_rows","durable_hunts","hunt_receipts"]) {
  const result = await client.query(`DELETE FROM ${table} WHERE account=$1 AND incarnation=$2`,[scope.account,scope.incarnation]);
  counts[table] = result.rowCount ?? 0;
  if ((await client.query(`SELECT 1 FROM ${table} WHERE account=$1 AND incarnation=$2 LIMIT 1`,[scope.account,scope.incarnation])).rowCount) throw new Error("Hunts erasure survivor");
 }
 return counts;
}

export async function countRecentHunts(client: pg.PoolClient, scope: AccountScope) {
 return (await client.query<{count:number}>("SELECT count(*)::integer AS count FROM durable_hunts WHERE account=$1 AND incarnation=$2",[scope.account,scope.incarnation])).rows[0]?.count ?? 0;
}
export async function readRecentHunts(client: pg.PoolClient, scope: AccountScope, after: string, limit: number) {
 const cursor = after ? z.strictObject({started_at:z.iso.datetime(),id:z.string().max(128)}).parse(JSON.parse(after)) : null;
 return (await client.query("SELECT id,data->>'startedAt' AS started_at,data->'final'->>'kind' AS state FROM durable_hunts WHERE account=$1 AND incarnation=$2 AND ($3::text IS NULL OR (data->>'startedAt',id)<($3,$4)) ORDER BY data->>'startedAt' DESC,id DESC LIMIT $5",[scope.account,scope.incarnation,cursor?.started_at ?? null,cursor?.id ?? null,limit])).rows;
}
