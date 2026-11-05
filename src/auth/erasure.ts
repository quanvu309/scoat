import type pg from "pg";
import type { AccountScope } from "../domain.js";
export async function deleteAuthentication(client: pg.PoolClient, scope: AccountScope, identities: readonly {issuer: string; subject: string}[]) {
 const counts: Record<string,number> = {};
 const prefix = [scope.account,scope.incarnation];
 for (const identity of identities) {
  const flows = await client.query("DELETE FROM oauth_browser_flows WHERE data->'context'->>'issuer'=$1 AND data->'context'->>'subject'=$2",[identity.issuer,identity.subject]);
  counts.enrollment_flows = (counts.enrollment_flows ?? 0)+(flows.rowCount ?? 0);
 }
 for (const table of ["oauth_read_grants","oauth_identities"]) {
  const deleted = await client.query(`DELETE FROM ${table} WHERE account=$1 AND incarnation=$2`,prefix);
  counts[table] = deleted.rowCount ?? 0;
  if ((await client.query(`SELECT 1 FROM ${table} WHERE account=$1 AND incarnation=$2 LIMIT 1`,prefix)).rowCount) throw new Error("Authentication erasure survivor");
 }
 const artifacts = await client.query("DELETE FROM oauth_artifacts WHERE (model,id) IN (SELECT model,id FROM oauth_artifact_owners WHERE account=$1)",[scope.account]);
 counts.oauth_artifacts = artifacts.rowCount ?? 0;
 const flows = await client.query("DELETE FROM oauth_browser_flows WHERE state IN (SELECT state FROM oauth_browser_flow_owners WHERE account=$1) OR data->'context'->'target'->>'account'=$1 OR data->'context'->>'account'=$1",[scope.account]);
 counts.oauth_browser_flows = flows.rowCount ?? 0;
 if ((await client.query("SELECT 1 FROM oauth_artifact_owners WHERE account=$1 UNION ALL SELECT 1 FROM oauth_browser_flows WHERE state IN (SELECT state FROM oauth_browser_flow_owners WHERE account=$1) OR data->'context'->'target'->>'account'=$1 OR data->'context'->>'account'=$1 LIMIT 1",[scope.account])).rowCount) throw new Error("OAuth ownership survivor");
 return counts;
}
