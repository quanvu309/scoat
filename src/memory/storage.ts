import type pg from "pg";
import { z } from "zod";
import type { AccountScope, Profile } from "../domain.js";
import { profileSchema } from "./contracts.js";
export async function readDeclaredProfile(client: pg.PoolClient, scope: AccountScope): Promise<{ value: Profile; provenance: { kind: "declared"; revision: string } | { kind: "default" } }> {
 const row = (await client.query("SELECT revision,value FROM memory_profiles WHERE account=$1 AND incarnation=$2",[scope.account,scope.incarnation])).rows[0];
 return row ? { value: profileSchema.parse(row.value), provenance: { kind: "declared", revision: z.uuid().parse(row.revision) } } : { value: { student: "unknown", cards: [], memberships: [] }, provenance: { kind: "default" } };
}
export async function deleteMemory(client: pg.PoolClient, scope: AccountScope) {
 const counts: Record<string,number> = {};
 for (const table of ["memory_profiles","memory_items","memory_commands"]) {
  const result = await client.query(`DELETE FROM ${table} WHERE account=$1 AND incarnation=$2`,[scope.account,scope.incarnation]);
  counts[table] = result.rowCount ?? 0;
  if ((await client.query(`SELECT 1 FROM ${table} WHERE account=$1 AND incarnation=$2 LIMIT 1`,[scope.account,scope.incarnation])).rowCount) throw new Error("Memory erasure survivor");
 }
 return counts;
}
