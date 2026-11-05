import { retryTransaction } from "../db/transaction.js";
import type { Adapter, AdapterPayload } from "oidc-provider";
import type pg from "pg";
import { z } from "zod";

class InactiveArtifact extends Error {}
export function artifactAccounts(payload: unknown): string[] {
 const owners = new Set<string>();
 function visit(value: unknown) {
  if (Array.isArray(value)) { for (const entry of value) visit(entry); return; }
  if (value === null || typeof value !== "object") return;
  for (const [key,entry] of Object.entries(value)) {
   if (key === "accountId") owners.add(z.string().min(1).max(128).parse(entry));
   else visit(entry);
  }
 }
 visit(payload);
 return [...owners].sort();
}
export function postgresAdapter(pool: pg.Pool) {
 return (model: string): Adapter => {
  const transaction = <T,>(run: (client: pg.PoolClient) => Promise<T>) => retryTransaction(pool,run);
  async function fence(client: pg.PoolClient, payload: AdapterPayload) {
   const owners = new Set(artifactAccounts(payload));
   const parents: { model: string; id: string; payload: AdapterPayload }[] = [];
   for (const [field,parentModel,column] of [["grantId","Grant","id"],["sessionUid","Session","payload->>'uid'"]]) {
    if (!field || !parentModel || !column || !(field in payload)) continue;
    const value = z.string().min(1).parse(Reflect.get(payload,field));
    const parent = (await client.query<{ id: string; payload: AdapterPayload }>(`SELECT id,payload FROM oauth_artifacts WHERE model=$1 AND ${column}=$2 AND expires_at>now()`, [parentModel,value])).rows[0];
    if (!parent) throw new InactiveArtifact("OAuth parent unavailable");
    parents.push({ model: parentModel, ...parent });
    for (const account of artifactAccounts(parent.payload)) owners.add(account);
    const inherited = await client.query<{account:string}>("SELECT account FROM oauth_artifact_owners WHERE model=$1 AND id=$2",[parentModel,parent.id]);
    for (const row of inherited.rows) owners.add(row.account);
   }
   for (const owner of [...owners].sort()) {
    const active = await client.query("SELECT 1 FROM hunt_accounts WHERE account=$1 AND NOT erased ORDER BY incarnation FOR SHARE", [owner]);
    if (!active.rowCount) throw new InactiveArtifact("Inactive OAuth owner");
   }
   for (const parent of parents) {
    const current = (await client.query<{ payload: AdapterPayload }>("SELECT payload FROM oauth_artifacts WHERE model=$1 AND id=$2 AND expires_at>now() FOR SHARE", [parent.model,parent.id])).rows[0];
    if (!current || JSON.stringify(current.payload) !== JSON.stringify(parent.payload)) throw new InactiveArtifact("OAuth parent changed");
   }
   return [...owners];
  }
  async function lookup(field: "id" | "uid" | "userCode", value: string) {
   try { return await transaction(async client => {
    const column = field === "id" ? "id" : "payload->>'"+field+"'";
    const row = (await client.query<{ id: string; payload: AdapterPayload }>(`SELECT id,payload FROM oauth_artifacts WHERE model=$1 AND ${column}=$2 AND expires_at>now()`, [model,value])).rows[0];
    if (!row) return undefined;
    await fence(client,row.payload);
    const current = (await client.query<{ payload: AdapterPayload }>("SELECT payload FROM oauth_artifacts WHERE model=$1 AND id=$2 AND expires_at>now() AND payload=$3::jsonb", [model,row.id,row.payload])).rows[0];
    return current?.payload;
   }); } catch(error) { if (error instanceof InactiveArtifact) return undefined; throw error; }
  }
  return {
   async upsert(id,payload,expiresIn) {
    if (!expiresIn || !Number.isSafeInteger(expiresIn) || expiresIn < 1) throw new Error("OAuth artifacts require bounded expiry");
    await transaction(async client => {
     await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[JSON.stringify(["artifact",model,id])]);
     const previous = (await client.query<{ payload: AdapterPayload }>("SELECT payload FROM oauth_artifacts WHERE model=$1 AND id=$2",[model,id])).rows[0];
     if (previous) {
      if (artifactAccounts(previous.payload).some(owner => !artifactAccounts(payload).includes(owner))) throw new InactiveArtifact("OAuth ownership cannot change");
     }
     const owners = await fence(client,payload);
     const oldOwners = await client.query<{account:string}>("SELECT account FROM oauth_artifact_owners WHERE model=$1 AND id=$2",[model,id]);
     if (oldOwners.rows.some(row => !owners.includes(row.account))) throw new InactiveArtifact("OAuth ownership cannot be removed");
     await client.query("INSERT INTO oauth_artifacts(model,id,payload,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 second') ON CONFLICT(model,id) DO UPDATE SET payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at", [model,id,payload,Math.min(expiresIn,["RefreshToken","Grant","Session"].includes(model) ? 2592000 : model === "Interaction" ? 300 : 3600)]);
     await client.query("DELETE FROM oauth_artifact_owners WHERE model=$1 AND id=$2", [model,id]);
     for (const owner of owners) await client.query("INSERT INTO oauth_artifact_owners(model,id,account) VALUES($1,$2,$3)", [model,id,owner]);
    });
   },
   find: id => lookup("id",id), findByUid: uid => lookup("uid",uid), findByUserCode: code => lookup("userCode",code),
   async consume(id) {
    await transaction(async client => {
     const row = (await client.query<{ payload: AdapterPayload }>("SELECT payload FROM oauth_artifacts WHERE model=$1 AND id=$2 AND expires_at>now()", [model,id])).rows[0];
     if (!row) throw new Error("Artifact unavailable");
     await fence(client,row.payload);
     const result = await client.query("UPDATE oauth_artifacts SET payload=jsonb_set(payload,'{consumed}',to_jsonb(extract(epoch from now())::bigint)) WHERE model=$1 AND id=$2 AND NOT payload ? 'consumed' AND payload=$3::jsonb", [model,id,row.payload]);
     if (!result.rowCount) throw new Error("Artifact already consumed");
    });
   },
   async destroy(id) { await transaction(client => client.query("DELETE FROM oauth_artifacts WHERE model=$1 AND id=$2", [model,id])); },
   async revokeByGrantId(id) { await transaction(client => client.query("DELETE FROM oauth_artifacts WHERE model=$1 AND payload->>'grantId'=$2", [model,id])); },
  };
 };
}
