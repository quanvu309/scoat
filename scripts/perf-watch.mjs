import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { withDatabase } from "./durable-database.mjs";
import { watchFixture } from "./watch-fixture.mjs";

const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const evidence = process.env.SCOAT_EVIDENCE_DIR ?? path.join(os.homedir(), "tmp/scoat-delivery/p08", "perf-" + Date.now());
await mkdir(evidence, { recursive: true });
const pages = 100, batches = 5, concurrency = 4;
const date = n => new Date(Date.UTC(2027, 5, n)).toISOString().slice(0, 10);
const pool = async (items, run) => { const results = []; let next = 0; await Promise.all(Array.from({ length: concurrency }, async () => { while (next < items.length) { const index = next++; results[index] = await run(items[index]); } })); return results; };
const result = await withDatabase(async url => {
 const w = await watchFixture(url);
 try {
  const seeded = [];
  for (let account = 0; account < pages / 10; account++) {
   const first = await w.seedWatch();
   seeded.push(first);
   for (let n = 1; n < 10; n++) seeded.push(await w.seedWatch({ account: first.account, incarnation: first.incarnation, address: first.address }));
  }
  await w.startWorker();
  const checker = w.watches();
  const samples = [];
  for (let batch = 0; batch <= batches; batch++) {
   w.state.pence = 5600 - batch * 10;
   const hitsBefore = w.state.hits;
   const started = performance.now();
   const outcomes = await pool(seeded, item => checker.check({ account: item.account, incarnation: item.incarnation, watch: item.watch, day: date(batch + 1) }));
   const checkSeconds = (performance.now() - started) / 1000;
   const keys = (await w.pool.query("SELECT provider_key FROM watch_alerts WHERE day=$1::date", [date(batch + 1)])).rows.map(row => row.provider_key);
   await Promise.all(keys.map(key => w.waitAccepted(key)));
   const settledSeconds = (performance.now() - started) / 1000;
   const queue = (await w.pool.query(`SELECT extract(epoch FROM started_on-created_on)*1000 AS delay FROM ${w.queueSchema}.job WHERE name='watch-send' AND data->>'alert' IN (SELECT id::text FROM watch_alerts WHERE day=$1::date)`, [date(batch + 1)])).rows.map(row => Number(row.delay));
   samples.push({ batch, warmup: batch === 0, fixturePages: w.state.hits - hitsBefore, checks: outcomes.length, alerts: outcomes.filter(item => item.alert).length, unknown: outcomes.filter(item => item.observation?.kind === "unknown").length, checkSeconds, settledSeconds, eligibleToOutboxMilliseconds: outcomes.map(item => item.outboxMilliseconds), queueSchedulingDelayMilliseconds: queue });
  }
  const deliveries = await w.deliveries();
  const perKey = deliveries.reduce((all, item) => ({ ...all, [item.key]: (all[item.key] ?? 0) + 1 }), {});
  return { samples, maxAcceptedPerIdentity: Math.max(...Object.values(perKey)), identities: Object.keys(perKey).length };
 } finally { await w.close(); }
});
const warm = result.samples.filter(sample => !sample.warmup);
const maxOutbox = Math.max(...warm.flatMap(sample => sample.eligibleToOutboxMilliseconds));
const maxBatch = Math.max(...warm.map(sample => sample.checkSeconds));
const pass = warm.length === batches && warm.every(sample => sample.checks === pages && sample.alerts === pages) && maxBatch < 30 && maxOutbox < 5000 && result.maxAcceptedPerIdentity <= 1;
const receipt = { status: pass ? "PASS_LOCAL_ONLY" : "FAIL", head, evidence, rule: { batchSeconds: "<30 for 100 local fixture checks", eligibleToOutboxMilliseconds: "<5000", acceptedPerIdentity: "<=1" }, maxBatchSeconds: maxBatch, maxEligibleToOutboxMilliseconds: maxOutbox, maxAcceptedPerIdentity: result.maxAcceptedPerIdentity, identities: result.identities, trunk: { value: "unavailable", reason: "trunk 1e40390 has no watch feature; no like-for-like operation exists, so no ratio is formed" }, exclusions: ["database installation", "TLS certificate generation", "seeding 100 watches", "warmup batch 0", "worker startup"], fixture: "100 local HTTPS fetch pairs per batch against the recorded Pi Hut format with synthetic price edits", runner: { cpus: os.cpus().length, model: os.cpus()[0]?.model ?? "unknown", memoryBytes: os.totalmem(), node: process.version, platform: os.platform() + " " + os.release() + " " + os.arch() }, fixedTwoCpu: "UNTESTED" };
await writeFile(path.join(evidence, "samples.json"), JSON.stringify(result.samples, null, 1));
await writeFile(path.join(evidence, "receipt.json"), JSON.stringify(receipt, null, 1));
console.log(JSON.stringify({ status: receipt.status, evidence, maxBatchSeconds: maxBatch, maxEligibleToOutboxMilliseconds: maxOutbox, maxAcceptedPerIdentity: result.maxAcceptedPerIdentity }));
if (!pass) process.exitCode = 1;
