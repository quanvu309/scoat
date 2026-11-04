import { begin } from "../db/lineage.js";
import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import type { HuntId, Id } from "../domain.js";
import { z } from "zod";
import type { Principal } from "./issuer.js";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class ReadGrantFailure extends Error {
 constructor(readonly code: "expired"|"revoked") { super(code); }
}
export class ReadGrants {
  constructor(private readonly pool: pg.Pool) {}
  private async query(principal: Principal, sql: string, values: unknown[]) {
    const client = await this.pool.connect();
    try {
      await begin(client);
      const active = await client.query(
        "SELECT 1 FROM hunt_accounts WHERE account=$1 AND incarnation=$2 AND NOT erased FOR SHARE",
        [principal.agent.account, principal.agent.incarnation],
      );
      if (!active.rowCount) throw new ReadGrantFailure("revoked");
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
  async open(principal: Principal, hunt: HuntId) {
    const grant = z.string().min(1).brand<"ReadGrantId">().parse(randomBytes(32).toString("base64url"));
    const { agent, session } = principal;
    const result = await this.query(
      principal,
      "INSERT INTO oauth_read_grants(digest,account,incarnation,hunt,session,permission,expires_at) SELECT $1,h.account,h.incarnation,h.id,$5,'read',now()+interval '5 minutes' FROM durable_hunts h JOIN hunt_accounts a USING(account,incarnation) WHERE h.account=$2 AND h.incarnation=$3 AND h.id=$4 AND NOT a.erased RETURNING expires_at",
      [digest(grant), agent.account, agent.incarnation, hunt, session],
    );
    if (!result.rowCount) throw new ReadGrantFailure("revoked");
    return { grant, expiresAt: result.rows[0].expires_at };
  }
  async use(
    principal: Principal,
    hunt: HuntId,
    grant: Id<"ReadGrantId">,
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
      const renewed = z.string().min(1).brand<"ReadGrantId">().parse(randomBytes(32).toString("base64url"));
      const result = await this.query(
        principal,
        "WITH prior AS (UPDATE oauth_read_grants SET revoked=true WHERE " +
          predicate +
          " RETURNING account,incarnation,hunt,session,permission) INSERT INTO oauth_read_grants(digest,account,incarnation,hunt,session,permission,expires_at) SELECT $6,p.account,p.incarnation,p.hunt,p.session,p.permission,now()+interval '5 minutes' FROM prior p JOIN hunt_accounts a USING(account,incarnation) WHERE NOT a.erased RETURNING expires_at",
        [...values, digest(renewed)],
      );
      if (!result.rowCount) throw new ReadGrantFailure("revoked");
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
    if (!result.rowCount) {
      if(op === "read") {
        const expired = await this.query(principal,"SELECT 1 FROM oauth_read_grants WHERE digest=$1 AND account=$2 AND incarnation=$3 AND hunt=$4 AND session=$5 AND permission='read' AND NOT revoked AND expires_at<=now()",values);
        if(expired.rowCount) throw new ReadGrantFailure("expired");
      }
      throw new ReadGrantFailure("revoked");
    }
    return { revoked: op === "revoke" };
  }
}
