import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { withDatabase } from "./durable-database.mjs";
import { scratchDirectory } from "./scratch.mjs";
import { retryTransaction } from "../dist/db/transaction.js";
import { inspect } from "../dist/db/lineage.js";
import { verifyRelease } from "../dist/release.js";

const exec = promisify(execFile);
const checkout = new URL("..", import.meta.url).pathname;
const evidence = process.env.SCOAT_EVIDENCE_DIR ?? await scratchDirectory("perf-", path.join(os.homedir(), "tmp/scoat-delivery/p09"));
const warmupPairs = 50, batches = 5, pairsPerBatch = 200, releaseSamples = 10;
const probe = "UPDATE perf_probe SET n = n + 1 WHERE id = 1";
const sorted = values => [...values].sort((a, b) => a - b);
const quantile = (values, q) => sorted(values)[Math.min(values.length - 1, Math.floor(q * values.length))];
const summary = values => ({ count: values.length, p50Ms: quantile(values, 0.5), p95Ms: quantile(values, 0.95), maxMs: Math.max(...values) });
const memory = () => ({ rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed, systemFreeBytes: os.freemem(), systemTotalBytes: os.totalmem() });

async function timed(run) {
 const started = performance.now();
 await run();
 return performance.now() - started;
}

const result = await withDatabase(async adminUrl => {
 const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
 const suffix = randomBytes(4).toString("hex");
 const role = "perf_owner_" + suffix, database = "perf_" + suffix, password = randomBytes(18).toString("hex");
 const url = new URL(adminUrl);
 url.username = role;
 url.password = password;
 url.pathname = "/" + database;
 let pool = null;
 try {
  await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
  await admin.query(`CREATE DATABASE ${database} OWNER ${role}`);
  await exec(process.execPath, ["scripts/database.mjs", "migrate"], { cwd: checkout, env: { ...process.env, DATABASE_URL: url.href } });
  pool = new pg.Pool({ connectionString: url.href, max: 1 });
  const server = (await pool.query("SELECT current_setting('server_version') AS version, current_setting('is_superuser') AS superuser, current_setting('synchronous_commit') AS synchronous_commit, current_setting('fsync') AS fsync")).rows[0];
  const lineage = await inspect(pool);
  if (lineage.kind !== "admitted") throw new Error("Measurement database is not admitted: " + JSON.stringify(lineage));
  await pool.query("CREATE TABLE perf_probe (id integer PRIMARY KEY, n bigint NOT NULL)");
  await pool.query("INSERT INTO perf_probe VALUES (1, 0)");
  const fenced = () => retryTransaction(pool, client => client.query(probe));
  const unfenced = async () => {
   const client = await pool.connect();
   try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await client.query(probe);
    await client.query("COMMIT");
   } catch (error) {
    await client.query("ROLLBACK");
    throw error;
   } finally { client.release(); }
  };
  for (let n = 0; n < warmupPairs; n++) { await fenced(); await unfenced(); }
  const rows = [];
  for (let batch = 0; batch < batches; batch++) {
   const load = os.loadavg(), before = memory();
   const fencedMs = [], unfencedMs = [];
   for (let n = 0; n < pairsPerBatch; n++) {
    if (n % 2 === 0) { fencedMs.push(await timed(fenced)); unfencedMs.push(await timed(unfenced)); }
    else { unfencedMs.push(await timed(unfenced)); fencedMs.push(await timed(fenced)); }
   }
   const fencedSummary = summary(fencedMs), unfencedSummary = summary(unfencedMs);
   rows.push({ batch, loadBefore: load, loadAfter: os.loadavg(), memoryBefore: before, memoryAfter: memory(), fenced: fencedSummary, unfencedMeasurementBaseline: unfencedSummary, overheadP50Ms: fencedSummary.p50Ms - unfencedSummary.p50Ms, overheadP95Ms: fencedSummary.p95Ms - unfencedSummary.p95Ms, fencedSamplesMs: fencedMs, unfencedSamplesMs: unfencedMs });
  }
  const committed = (await pool.query("SELECT n::integer AS n FROM perf_probe WHERE id = 1")).rows[0].n;
  const expected = 2 * (warmupPairs + batches * pairsPerBatch);
  if (committed !== expected) throw new Error("Probe commits " + committed + " differ from expected " + expected);
  const releaseMs = [];
  for (let n = 0; n < releaseSamples; n++) {
   let state;
   releaseMs.push(await timed(async () => { state = await verifyRelease(); }));
   if (state.kind !== "verified") throw new Error("Release verification refused during measurement: " + state.reason);
  }
  return { server, rows, committed, releaseVerification: { ...summary(releaseMs), samplesMs: releaseMs } };
 } finally {
  if (pool) await pool.end();
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [database]);
  await admin.query(`DROP DATABASE IF EXISTS ${database}`);
  await admin.query(`DROP ROLE IF EXISTS ${role}`);
  await admin.end();
 }
});

const git = args => execFileSync("git", args, { cwd: checkout, encoding: "utf8", maxBuffer: 1 << 26 });
const overheads = result.rows.map(row => row.overheadP50Ms);
const report = {
 scope: "P09 operations performance: lineage fence overhead per transaction and release verification",
 head: git(["rev-parse", "HEAD"]).trim(),
 porcelain: git(["status", "--porcelain"]),
 trackedPatchSha256: createHash("sha256").update(git(["diff", "HEAD"])).digest("hex"),
 command: ["npm", "run", "perf", "--", "p09"],
 node: process.version,
 postgres: result.server,
 database: process.env.DATABASE_URL ? "DATABASE_URL service (credentials withheld)" : "embedded local PostgreSQL cluster",
 cpu: os.cpus()[0]?.model ?? "unknown",
 logicalCpus: os.cpus().length,
 availableParallelism: os.availableParallelism(),
 platform: `${os.platform()} ${os.release()} ${os.arch()}`,
 method: {
  operation: probe,
  fenced: "application retryTransaction: pool connect, BEGIN READ COMMITTED, schema-scoped shared lineage advisory lock, lineage admission read, the operation, COMMIT",
  unfencedMeasurementBaseline: "MEASUREMENT ONLY, never application authority: the same pool connect, BEGIN READ COMMITTED, operation and COMMIT without the lineage lock and admission read",
  pairing: "pairs alternate fenced/unfenced order within each batch on one pooled connection",
  warmupPairs,
  batches,
  pairsPerBatch,
 },
 committedProbeUpdates: result.committed,
 overheadP50MsPerBatch: overheads,
 bottleneck: "The fence adds two sequential statements per transaction (pg_advisory_xact_lock_shared and the lineage row read with the scoat_lineage_identity xmin function); overhead is local round-trip latency, not lock contention, because one connection runs serially with no exclusive holder",
 exclusions: ["installation and build", "migration and database creation", "warmup pairs", "concurrent contention and exclusive seal/admit holders", "network latency to a remote database", "end-to-end hunt or story work"],
 trunk: "unavailable: trunk has no runnable hunt; no trunk ratio is recorded",
 fixedTwoCpuBudget: "UNTESTED: no independently provisioned fixed two-CPU runner",
 storyMeasurement: "pending: the parent P09 linked story adds end-to-end measurement",
 releaseVerification: result.releaseVerification,
 batches: result.rows,
};
await writeFile(path.join(evidence, "perf.json"), JSON.stringify(report, null, 1) + "\n");
process.stdout.write(JSON.stringify({ evidence: path.join(evidence, "perf.json"), overheadP50MsPerBatch: overheads.map(value => Number(value.toFixed(3))), fencedP50Ms: result.rows.map(row => Number(row.fenced.p50Ms.toFixed(3))), releaseVerificationP50Ms: Number(result.releaseVerification.p50Ms.toFixed(3)), trunk: report.trunk, logicalCpus: report.logicalCpus }) + "\n");
