import type { Adapter, AdapterPayload } from "oidc-provider";
import type pg from "pg";

export function postgresAdapter(pool: pg.Pool) {
  return (model: string): Adapter => {
    async function lookup(field: "id" | "uid" | "userCode", value: string) {
      const column = field === "id" ? "id" : "payload->>'" + field + "'";
      const result = await pool.query<{ payload: AdapterPayload }>(
        `SELECT payload FROM oauth_artifacts WHERE model=$1 AND ${column}=$2 AND expires_at>now()`,
        [model, value],
      );
      return result.rows[0]?.payload;
    }
    return {
      async upsert(id, payload, expiresIn) {
        if (!expiresIn || !Number.isSafeInteger(expiresIn) || expiresIn < 1)
          throw new Error("OAuth artifacts require bounded expiry");
        await pool.query(
          "INSERT INTO oauth_artifacts(model,id,payload,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 second') ON CONFLICT(model,id) DO UPDATE SET payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at",
          [model, id, payload, expiresIn],
        );
      },
      find: (id) => lookup("id", id),
      findByUid: (uid) => lookup("uid", uid),
      findByUserCode: (code) => lookup("userCode", code),
      async consume(id) {
        const result = await pool.query(
          "UPDATE oauth_artifacts SET payload=jsonb_set(payload,'{consumed}',to_jsonb(extract(epoch from now())::bigint)) WHERE model=$1 AND id=$2 AND NOT payload ? 'consumed'",
          [model, id],
        );
        if (!result.rowCount) throw new Error("Artifact already consumed");
      },
      async destroy(id) {
        await pool.query(
          "DELETE FROM oauth_artifacts WHERE model=$1 AND id=$2",
          [model, id],
        );
      },
      async revokeByGrantId(id) {
        await pool.query(
          "DELETE FROM oauth_artifacts WHERE model=$1 AND payload->>'grantId'=$2",
          [model, id],
        );
      },
    };
  };
}
