import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import type { Agent } from "../domain.js";

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
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      JSON.stringify([issuer, subject]),
    ]);
    const existing = await client.query(
      "SELECT account,incarnation FROM oauth_identities WHERE issuer=$1 AND subject=$2",
      [issuer, subject],
    );
    let scope = existing.rows[0];
    if (!scope) {
      scope = { account: randomUUID(), incarnation: randomUUID() };
      await client.query(
        "INSERT INTO hunt_accounts(account,incarnation) VALUES($1,$2)",
        [scope.account, scope.incarnation],
      );
      await client.query(
        "INSERT INTO oauth_identities(issuer,subject,account,incarnation) VALUES($1,$2,$3,$4)",
        [issuer, subject, scope.account, scope.incarnation],
      );
    }
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
const verified = Symbol("verified OAuth principal");
export type Principal = Readonly<{
  agent: Agent;
  session: string;
  scopes: ReadonlySet<string>;
  [verified]: true;
}>;
export async function principalFor(
  pool: pg.Pool,
  account: string,
  client: string,
  session: string,
  scope: string,
): Promise<Principal> {
  const result = await pool.query(
    "SELECT account,incarnation FROM oauth_identities WHERE account=$1",
    [account],
  );
  const parsed = accountScope.parse(result.rows[0]);
  const active = await pool.query(
    "SELECT 1 FROM hunt_accounts WHERE account=$1 AND incarnation=$2 AND NOT erased",
    [parsed.account, parsed.incarnation],
  );
  if (!active.rowCount) throw new Error("Inactive account incarnation");
  return {
    agent: { ...parsed, kind: "agent", client },
    session,
    scopes: new Set(scope.split(" ")),
    [verified]: true,
  };
}
