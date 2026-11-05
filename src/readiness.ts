import type pg from "pg";
import { fileURLToPath } from "node:url";
import { observe } from "./db/lineage.js";
import { releaseJournal, type JournalStatus, type ReleaseJournal } from "./db/journal.js";
import type { ReleaseState } from "./release.js";

export type Health = Readonly<{
 ready: boolean;
 reasons: readonly string[];
 artifact: Readonly<{ status: "verified"; digest: string }> | Readonly<{ status: "refused"; reason: string }>;
 database: "available" | "unavailable" | "unconfigured";
 schema: Readonly<{ expected: string | null; current: string | null; status: JournalStatus | "unknown" }>;
 lineage: string;
 auth: "configured" | "unavailable";
 transport: "https" | "http";
}>;

let shipped: Promise<ReleaseJournal | null> | null = null;

function shippedJournal(): Promise<ReleaseJournal | null> {
 shipped ??= releaseJournal(fileURLToPath(new URL("../db/migrations", import.meta.url))).catch(() => null);
 return shipped;
}

export async function health(release: ReleaseState, pool: pg.Pool | null, authConfigured: boolean, encrypted: boolean): Promise<Health> {
 const journal = await shippedJournal();
 const observed = pool ? await observe(pool, journal) : null;
 const database = observed === null ? "unconfigured" : observed.database;
 const installed = observed?.database === "available" ? observed.journal : null;
 const schemaStatus = installed === null ? "unknown" : installed.status;
 const lineage = observed?.database === "available" ? observed.lineage : "unknown";
 const reasons = [
  ...(release.kind === "verified" ? [] : [release.reason]),
  ...(database === "available" ? [] : ["database-" + database]),
  ...(schemaStatus === "current" || database !== "available" ? [] : ["schema-" + schemaStatus]),
  ...(lineage === "admitted" || lineage === "unknown" ? [] : ["lineage-" + lineage]),
  ...(authConfigured ? [] : ["auth-unconfigured"]),
  ...(encrypted ? [] : ["transport-unencrypted"]),
 ];
 return {
  ready: reasons.length === 0,
  reasons,
  artifact: release.kind === "verified" ? { status: "verified", digest: release.release.digest } : { status: "refused", reason: release.reason },
  database,
  schema: { expected: journal?.head.tag ?? null, current: installed?.current ?? null, status: schemaStatus },
  lineage,
  auth: authConfigured ? "configured" : "unavailable",
  transport: encrypted ? "https" : "http",
 };
}
