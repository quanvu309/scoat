import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import type { Principal } from "./identity.js";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class ReadGrants {
  constructor(private readonly pool: pg.Pool) {}
  private async query(principal: Principal, sql: string, values: unknown[]) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const active = await client.query(
        "SELECT 1 FROM hunt_accounts WHERE account=$1 AND incarnation=$2 AND NOT erased FOR SHARE",
        [principal.agent.account, principal.agent.incarnation],
      );
      if (!active.rowCount) throw new Error("Inactive account incarnation");
      const result = await client.query(sql, values);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async open(principal: Principal, hunt: string) {
    const grant = randomBytes(32).toString("base64url");
    const { agent, session } = principal;
    const result = await this.query(
      principal,
      "INSERT INTO oauth_read_grants(digest,account,incarnation,hunt,session,permission,expires_at) SELECT $1,h.account,h.incarnation,h.id,$5,'read',now()+interval '5 minutes' FROM durable_hunts h JOIN hunt_accounts a USING(account,incarnation) WHERE h.account=$2 AND h.incarnation=$3 AND h.id=$4 AND NOT a.erased RETURNING expires_at",
      [digest(grant), agent.account, agent.incarnation, hunt, session],
    );
    if (!result.rowCount) throw new Error("Hunt unavailable");
    return { grant, expiresAt: result.rows[0].expires_at };
  }
  async use(
    principal: Principal,
    hunt: string,
    grant: string,
    op: "read" | "renew" | "revoke",
  ) {
    const { agent, session } = principal;
    const values = [
      digest(grant),
      agent.account,
      agent.incarnation,
      hunt,
      session,
    ];
    const predicate =
      "digest=$1 AND account=$2 AND incarnation=$3 AND hunt=$4 AND session=$5 AND permission='read' AND NOT revoked " +
      (op === "read" ? " AND expires_at>now()" : "");
    if (op === "renew") {
      const renewed = randomBytes(32).toString("base64url");
      const result = await this.query(
        principal,
        "WITH prior AS (UPDATE oauth_read_grants SET revoked=true WHERE " +
          predicate +
          " RETURNING account,incarnation,hunt,session,permission) INSERT INTO oauth_read_grants(digest,account,incarnation,hunt,session,permission,expires_at) SELECT $6,p.account,p.incarnation,p.hunt,p.session,p.permission,now()+interval '5 minutes' FROM prior p JOIN hunt_accounts a USING(account,incarnation) WHERE NOT a.erased RETURNING expires_at",
        [...values, digest(renewed)],
      );
      if (!result.rowCount) throw new Error("Read capability unavailable");
      return { grant: renewed, expiresAt: result.rows[0].expires_at };
    }
    const result = await this.query(
      principal,
      op === "read"
        ? "SELECT 1 FROM oauth_read_grants WHERE " + predicate
        : "UPDATE oauth_read_grants SET revoked=true WHERE " +
            predicate +
            " RETURNING digest",
      values,
    );
    if (!result.rowCount) throw new Error("Read capability unavailable");
    return { revoked: op === "revoke" };
  }
}
