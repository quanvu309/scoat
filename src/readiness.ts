import type pg from "pg";
import { lineageSchemaHead, observe } from "./db/lineage.js";
import type { ReleaseState } from "./release.js";

export type Health = Readonly<{
 ready: boolean;
 reasons: readonly string[];
 artifact: Readonly<{ status: "verified"; digest: string }> | Readonly<{ status: "refused"; reason: string }>;
 database: "available" | "unavailable" | "unconfigured";
 schema: Readonly<{ expected: string; current: string | null; status: "current" | "drift" | "absent" | "unknown" }>;
 lineage: string;
 auth: "configured" | "unavailable";
 transport: "https" | "http";
}>;

export async function health(release: ReleaseState, pool: pg.Pool | null, authConfigured: boolean, encrypted: boolean): Promise<Health> {
 const observed = pool ? await observe(pool) : null;
 const database = observed === null ? "unconfigured" : observed.database;
 const current = observed?.database === "available" ? observed.schemaHead : null;
 const schemaStatus = observed?.database !== "available" ? "unknown" : current === null ? "absent" : current === lineageSchemaHead ? "current" : "drift";
 const lineage = observed?.database === "available" ? observed.lineage : "unknown";
 const reasons = [
  ...(release.kind === "verified" ? [] : [release.reason]),
  ...(database === "available" ? [] : ["database-" + database]),
  ...(schemaStatus === "current" || schemaStatus === "unknown" ? [] : ["schema-" + schemaStatus]),
  ...(lineage === "admitted" || lineage === "unknown" ? [] : ["lineage-" + lineage]),
  ...(authConfigured ? [] : ["auth-unconfigured"]),
  ...(encrypted ? [] : ["transport-unencrypted"]),
 ];
 return {
  ready: reasons.length === 0,
  reasons,
  artifact: release.kind === "verified" ? { status: "verified", digest: release.release.digest } : { status: "refused", reason: release.reason },
  database,
  schema: { expected: lineageSchemaHead, current, status: schemaStatus },
  lineage,
  auth: authConfigured ? "configured" : "unavailable",
  transport: encrypted ? "https" : "http",
 };
}
