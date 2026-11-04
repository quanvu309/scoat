import { retryTransaction } from "../db/transaction.js";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import type { AccountScope } from "../domain.js";
import { releaseSchema } from "../knowledge/index.js";
import { readFinishedResult, countRecentHunts, readRecentHunts } from "../hunt/postgres.js";
import { digest } from "../hunt/postgres.js";
import { memoryInput, profileSchema } from "./contracts.js";
import { activeWatchCount, cancelWatch, readWatches, resolveWatchTarget, watchLimits } from "./watches.js";

type Caller = AccountScope & Readonly<{ client: string; session: string }>;
const cursorSchema = z.strictObject({ account: z.string(), incarnation: z.uuid(), collection: z.enum(["saved", "recent"]), after: z.string().max(256) });
const outcomeSchema = z.union([z.strictObject({ kind: z.literal("profile"), revision: z.uuid() }), z.strictObject({ kind: z.literal("saved"), item: z.uuid() }), z.strictObject({ kind: z.literal("unfinished") }), z.strictObject({ kind: z.literal("watching"), watch: z.uuid() }), z.strictObject({ kind: z.literal("watch-unavailable"), reason: z.enum(["no-exact-supported-variant", "ambiguous-variant", "watch-limit"]), limits: z.strictObject({ active: z.number().int(), seller: z.string() }) }), z.strictObject({ kind: z.literal("unwatched"), watch: z.uuid(), wasActive: z.boolean(), jobs: z.number().int(), acceptedAlerts: z.number().int(), mayStillArrive: z.number().int() })]);
export class Memory {
 constructor(private readonly pool: pg.Pool, private readonly issuer: string) {}
 private async transaction<T>(scope: Caller, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return retryTransaction(this.pool,async client => {
   const active = await client.query("SELECT 1 FROM hunt_accounts WHERE account=$1 AND incarnation=$2 AND NOT erased FOR SHARE",[scope.account,scope.incarnation]);
   if (!active.rowCount) throw new Error("Inactive account incarnation");
   const session = await client.query("SELECT 1 FROM oauth_artifacts WHERE model='Session' AND payload->>'uid'=$1 AND payload->>'accountId'=$2 AND expires_at>now() FOR SHARE",[scope.session,scope.account]);
   if (!session.rowCount) throw new Error("Inactive OAuth session");
   return run(client);
  });
 }

 async run(caller: Caller, raw: unknown) {
  const request = memoryInput.parse(raw);
  return this.transaction(caller, async client => {
   const prefix = [caller.account, caller.incarnation];
   if (request.op === "item") {
    const row = (await client.query("SELECT id,hunt,snapshot,release,digest,format,saved_at FROM memory_items WHERE account=$1 AND incarnation=$2 AND id=$3", [...prefix,request.item])).rows[0];
    if (!row) throw new Error("Saved item unavailable");
    const snapshot = z.json().parse(row.snapshot), release = releaseSchema.parse(row.release);
    if (row.format !== 1 || row.digest !== digest({snapshot,release,format:1})) throw new Error("Saved item integrity failure");
    return { kind: "item", item: { ...row, id: z.uuid().parse(row.id), snapshot,release } };
   }
   if (request.op === "read") {
    if (request.collection === "overview") {
     if (request.after) throw new Error("Overview has no cursor");
     const row = (await client.query("SELECT revision,value FROM memory_profiles WHERE account=$1 AND incarnation=$2", prefix)).rows[0];
     const count = (await client.query("SELECT count(*)::integer AS saved FROM memory_items WHERE account=$1 AND incarnation=$2", prefix)).rows[0];
     return { kind: "overview", profile: row ? { revision: z.uuid().parse(row.revision), value: profileSchema.parse(row.value) } : null, counts: {...count,hunts:await countRecentHunts(client,caller)} };
    }
    if (request.collection === "watches") {
     if (request.after) throw new Error("Watches have no cursor");
     return readWatches(client,caller);
    }
    let after = "";
    if (request.after) {
     const cursor = cursorSchema.parse(JSON.parse(Buffer.from(request.after,"base64url").toString("utf8")));
     if (cursor.account !== caller.account || cursor.incarnation !== caller.incarnation || cursor.collection !== request.collection) throw new Error("Cursor scope mismatch");
     after = cursor.after;
    }
    const rows = request.collection === "saved"
     ? (await client.query("SELECT id::text,hunt,saved_at FROM memory_items WHERE account=$1 AND incarnation=$2 AND id::text>$3 ORDER BY id::text LIMIT $4", [...prefix,after,request.limit+1])).rows
     : await readRecentHunts(client,caller,after,request.limit+1);
    const page = rows.slice(0,request.limit);
    return { kind: request.collection, items: page, next: rows.length > request.limit ? Buffer.from(JSON.stringify({ account: caller.account, incarnation: caller.incarnation, collection: request.collection, after: request.collection === "saved" ? page.at(-1)?.id : JSON.stringify({started_at:page.at(-1)?.started_at,id:page.at(-1)?.id}) })).toString("base64url") : null };
   }
   const finished = request.op === "save" ? await readFinishedResult(client,caller,request.hunt) : null;
   const commandDigest = digest(request);
   await client.query("INSERT INTO memory_commands(account,incarnation,key,digest,client,session,command) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING", [...prefix,request.requestKey,commandDigest,caller.client,caller.session,request]);
   const row = (await client.query("SELECT digest,client,session,approved,expires_at>now() AS fresh,replay_until>now() AS replay,outcome FROM memory_commands WHERE account=$1 AND incarnation=$2 AND key=$3 FOR UPDATE", [...prefix,request.requestKey])).rows[0];
   if (row.digest !== commandDigest) throw new Error("Request key has different payload");
   if (row.client !== caller.client || row.session !== caller.session || !row.replay) throw new Error("Command session unavailable");
   if (row.outcome) return outcomeSchema.parse(row.outcome);
   if (!row.fresh) throw new Error("Proposal expired; use a new request key");
   if (request.op === "unwatch") {
    const result = await cancelWatch(client,caller,request.watch);
    await client.query("UPDATE memory_commands SET outcome=$4,command=NULL,approved=false WHERE account=$1 AND incarnation=$2 AND key=$3", [...prefix,request.requestKey,result]);
    return result;
   }
   if (request.op === "watch") {
    const finished = await readFinishedResult(client,caller,request.hunt);
    const resolved = finished ? resolveWatchTarget(finished.snapshot) : null;
    const limited = resolved?.kind === "target" && await activeWatchCount(client,caller) >= watchLimits.active;
    if (resolved?.kind === "target" && !limited) return { kind: "confirmation-required", command: request, url: this.issuer + "/account/watch?account=" + encodeURIComponent(caller.account) + "&key=" + encodeURIComponent(request.requestKey), baseline: "A fresh public delivered price is observed in your browser confirmation; personalized, student, coupon, cashback or reward totals are never the baseline.", limits: { active: watchLimits.active, days: watchLimits.days } };
    const outcome = !finished ? { kind: "unfinished" as const } : { kind: "watch-unavailable" as const, reason: limited ? "watch-limit" as const : resolved?.kind === "unavailable" ? resolved.reason : "no-exact-supported-variant" as const, limits: { active: watchLimits.active, seller: "The Pi Hut Raspberry Pi 5, exact variant link, UK Royal Mail 1st Class only" } };
    await client.query("UPDATE memory_commands SET outcome=$4,command=NULL,approved=false WHERE account=$1 AND incarnation=$2 AND key=$3", [...prefix,request.requestKey,outcome]);
    return outcome;
   }
   if (!row.approved) return { kind: "confirmation-required", command: request, url: this.issuer + "/account/memory?account=" + encodeURIComponent(caller.account) + "&key=" + encodeURIComponent(request.requestKey) };
   let outcome: z.infer<typeof outcomeSchema>;
   if (request.op === "profile") {
    const revision = randomUUID();
    await client.query("INSERT INTO memory_profiles(account,incarnation,revision,value) VALUES($1,$2,$3,$4) ON CONFLICT(account,incarnation) DO UPDATE SET revision=EXCLUDED.revision,value=EXCLUDED.value", [...prefix,revision,request.profile]);
    outcome = { kind: "profile", revision };
   } else {
    if (!finished) outcome = { kind: "unfinished" };
    else {
     const { snapshot,release } = finished;
     const id = randomUUID();
     await client.query("INSERT INTO memory_items(account,incarnation,id,hunt,snapshot,release,digest) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(account,incarnation,hunt) DO NOTHING", [...prefix,id,request.hunt,snapshot,release,digest({ snapshot,release,format: 1 })]);
     const item = (await client.query("SELECT id FROM memory_items WHERE account=$1 AND incarnation=$2 AND hunt=$3", [...prefix,request.hunt])).rows[0];
     outcome = { kind: "saved", item: z.uuid().parse(item.id) };
    }
   }
   await client.query("UPDATE memory_commands SET outcome=$4,command=NULL,approved=false WHERE account=$1 AND incarnation=$2 AND key=$3", [...prefix,request.requestKey,outcome]);
   return outcome;
  });
 }
}
