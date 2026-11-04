import { begin } from "../db/lineage.js";

import type pg from "pg";
import { z } from "zod";

const accountScope = z.strictObject({
  account: z.uuid().brand<"AccountId">(),
  incarnation: z.uuid().brand<"Incarnation">(),
});
export async function resolveIdentity(
  pool: pg.Pool,
  issuer: string,
  subject: string,
) {
  z.string().min(1).max(4096).parse(subject);
  const client = await pool.connect();
  try {
    await begin(client);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      JSON.stringify([issuer, subject]),
    ]);
    const existing = await client.query(
      "SELECT account,incarnation FROM oauth_identities WHERE issuer=$1 AND subject=$2",
      [issuer, subject],
    );
    const scope = existing.rows[0];
    if (!scope) throw new UnknownIdentity("Explicit browser enrollment required");
    const active = await client.query(
      "SELECT 1 FROM hunt_accounts WHERE account=$1 AND incarnation=$2 AND NOT erased FOR SHARE",
      [scope.account, scope.incarnation],
    );
    if (!active.rowCount) throw new Error("Inactive account incarnation");
    await client.query("COMMIT");
    return accountScope.parse(scope);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class UnknownIdentity extends Error {}
