import { begin } from "../db/lineage.js";
import { deleteAuthentication } from "./erasure.js";
import { createHmac } from "node:crypto";
import type pg from "pg";
import type { AccountScope } from "../domain.js";

export async function linkIdentity(
  pool: pg.Pool,
  target: AccountScope,
  issuer: string,
  subject: string,
  startedAt: number,
  lifecycleKey: string,
) {
  const client = await pool.connect();
  try {
    await begin(client);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      JSON.stringify([issuer, subject]),
    ]);
    const pseudonym = createHmac("sha256",lifecycleKey).update(JSON.stringify([issuer,subject])).digest("hex");
    const suppressed = await client.query("SELECT 1 FROM account_suppression WHERE subject_digest=$1 AND erased_at>=to_timestamp($2/1000.0) AND purge_after>now() LIMIT 1",[pseudonym,startedAt]);
    if (suppressed.rowCount) throw new Error("Link flow predates erasure; start linking again");
    const existing = (
      await client.query(
        "SELECT account,incarnation FROM oauth_identities WHERE issuer=$1 AND subject=$2",
        [issuer, subject],
      )
    ).rows[0];
    const accounts = await client.query(
      "SELECT account,incarnation,erased FROM hunt_accounts WHERE account=ANY($1) ORDER BY account,incarnation FOR UPDATE",
      [[target.account, ...(existing ? [existing.account] : [])]],
    );
    if (
      !accounts.rows.some(
        (row) =>
          row.account === target.account &&
          row.incarnation === target.incarnation &&
          !row.erased,
      )
    )
      throw new Error("Inactive target account");
    if (
      existing &&
      !accounts.rows.some(
        (row) =>
          row.account === existing.account &&
          row.incarnation === existing.incarnation &&
          !row.erased,
      )
    )
      throw new Error("Erased identity cannot be linked");
    if (existing && existing.account !== target.account) {
      const hunts = await client.query(
        "SELECT 1 FROM durable_hunts WHERE account=$1 AND incarnation=$2 LIMIT 1",
        [existing.account, existing.incarnation],
      );
      if (hunts.rowCount)
        throw new Error(
          "Linking an account with existing hunts requires a separately verified data migration",
        );
      const privateState = await client.query("SELECT 1 FROM memory_profiles WHERE account=$1 AND incarnation=$2 UNION ALL SELECT 1 FROM memory_items WHERE account=$1 AND incarnation=$2 UNION ALL SELECT 1 FROM memory_commands WHERE account=$1 AND incarnation=$2 UNION ALL SELECT 1 FROM hunt_receipts WHERE account=$1 AND incarnation=$2 UNION ALL SELECT 1 FROM oauth_read_grants WHERE account=$1 AND incarnation=$2 LIMIT 1",[existing.account,existing.incarnation]);
      if (privateState.rowCount) throw new Error("Linking an account with private memory requires separate migration");
      const others = await client.query(
        "SELECT 1 FROM oauth_identities WHERE account=$1 AND incarnation=$2 AND (issuer<>$3 OR subject<>$4) LIMIT 1",
        [existing.account, existing.incarnation, issuer, subject],
      );
      if (others.rowCount) throw new Error("Linking an account with other identities requires a separately verified data migration");
      await client.query(
        "UPDATE hunt_accounts SET erased=true,erased_at=now() WHERE account=$1 AND incarnation=$2",
        [existing.account, existing.incarnation],
      );
      await deleteAuthentication(client,existing,[]);
    }
    await client.query(
      "INSERT INTO oauth_identities(issuer,subject,account,incarnation) VALUES($1,$2,$3,$4) ON CONFLICT(issuer,subject) DO UPDATE SET account=EXCLUDED.account,incarnation=EXCLUDED.incarnation",
      [issuer, subject, target.account, target.incarnation],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
