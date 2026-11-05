import { retryTransaction } from "../db/transaction.js";
import type pg from "pg";
import { z } from "zod";
export async function writeBrowserFlow(client: pg.PoolClient, state: string, raw: unknown) {
 const value = z.object({context:z.record(z.string(),z.unknown()),initiatedAt:z.number().int().optional()}).parse(raw);
 const initiatedAt = value.initiatedAt ?? z.coerce.number().int().parse((await client.query("SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS initiated_at")).rows[0]?.initiated_at);
 const owners = new Set<string>();
 if (value.context.account !== undefined) owners.add(z.string().parse(value.context.account));
 if (value.context.target !== undefined) owners.add(z.object({account:z.string()}).parse(value.context.target).account);
 for (const owner of [...owners].sort()) {
  if (!(await client.query("SELECT 1 FROM hunt_accounts WHERE account=$1 AND NOT erased ORDER BY incarnation FOR SHARE",[owner])).rowCount) throw new Error("Inactive browser flow owner");
 }
 await client.query("INSERT INTO oauth_browser_flows(state,data,expires_at) VALUES($1,$2,clock_timestamp()+interval '10 minutes')",[state,{...z.record(z.string(),z.unknown()).parse(raw),initiatedAt}]);
 for (const owner of owners) await client.query("INSERT INTO oauth_browser_flow_owners(state,account) VALUES($1,$2)",[state,owner]);
}
export async function persistBrowserFlow(pool: pg.Pool, state: string, data: unknown) {
 await retryTransaction(pool,client => writeBrowserFlow(client,state,data));
}
