import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { withDatabase } from "../scripts/durable-database.mjs";
import { watchFixture } from "../scripts/watch-fixture.mjs";
import { fixtureDelivery } from "../scripts/watch-delivery.mjs";
import { scratchDirectory } from "../scripts/scratch.mjs";
import { retryTransaction } from "../dist/db/transaction.js";
import { deleteScopedJobs, queueNames } from "../dist/queue/index.js";
import { Watches, deleteWatches, signUnsubscribe } from "../dist/memory/watches.js";
import { startWorker } from "../dist/worker.js";

const job = (seeded, day) => ({ account: seeded.account, incarnation: seeded.incarnation, watch: seeded.watch, day });
const send = (seeded, alert) => ({ account: seeded.account, incarnation: seeded.incarnation, watch: seeded.watch, alert });
async function lockWaiter(pool, blocker) {
 for (let attempt = 0; attempt < 200; attempt++) {
  const waiting = await pool.query("SELECT pid FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid))", [blocker]);
  if (waiting.rowCount) return waiting.rows[0].pid;
  await new Promise(resolve => setTimeout(resolve, 50));
 }
 throw new Error("Plan never waited on the account fence");
}

test("PostgreSQL watch corrections: lock order, all-state queue erasure, absent mail and one-click forms", async () => {
 await withDatabase(async url => {
  const w = await watchFixture(url);
  try {
   const seeded = await w.seedWatch();
   w.state.pence = 5500;
   const checked = await w.watches().check(job(seeded, "2027-03-01"));
   assert.ok(checked.alert);
   await w.pool.query("UPDATE watch_alerts SET deadline=clock_timestamp()-interval '1 second' WHERE id=$1", [checked.alert]);
   const fence = await w.pool.connect();
   let connects = 0;
   const counted = { connect: () => { connects++; return w.pool.connect(); } };
   const planner = new Watches({ pool: counted, delivery: w.delivery, config: w.config, enqueue: w.producer });
   let planning = null;
   try {
    await fence.query("BEGIN");
    const blocker = (await fence.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await fence.query("SELECT 1 FROM hunt_accounts WHERE account=$1 AND incarnation=$2 FOR UPDATE", [seeded.account, seeded.incarnation]);
    planning = planner.plan();
    await lockWaiter(w.pool, blocker);
    const probe = await w.pool.connect();
    try {
     await probe.query("BEGIN");
     const free = await probe.query("SELECT state FROM watch_alerts WHERE id=$1 FOR UPDATE NOWAIT", [checked.alert]).catch(error => { throw new Error("Plan locked the alert row before the account fence: " + error.code); });
     assert.equal(free.rows[0].state, "pending");
     await probe.query("ROLLBACK");
    } finally { probe.release(); }
    const erased = await deleteWatches(fence, seeded);
    await fence.query("UPDATE hunt_accounts SET erased=true WHERE account=$1 AND incarnation=$2", [seeded.account, seeded.incarnation]);
    await fence.query("COMMIT");
    const planned = await planning;
    assert.equal(connects, 1);
    assert.equal(erased.counts.watch_alerts, 1);
    assert.deepEqual({ checks: planned.checks, sends: planned.sends }, { checks: 0, sends: 0 });
   } finally {
    await fence.query("ROLLBACK").catch(() => undefined);
    fence.release();
    await planning?.catch(() => undefined);
   }

   const boss = new PgBoss({ connectionString: w.env.DATABASE_URL, schema: "pgboss", schedule: false, supervise: false, migrate: false });
   await boss.start();
   try {
    await boss.createQueue("watch-send-dead");
    const make = () => ({ account: randomUUID(), incarnation: randomUUID(), watch: randomUUID() });
    const a = make(), b = make();
    for (const scope of [a, b]) for (const [index, state] of ["created", "retry", "active", "completed", "failed", "cancelled"].entries()) {
     const id = await boss.send(queueNames.send, { ...scope, alert: randomUUID() }, { singletonKey: randomUUID() });
     if (state !== "created") await w.pool.query("UPDATE pgboss.job SET state=$1::pgboss.job_state WHERE id=$2", [state, id]);
     await boss.send(queueNames.check, { ...scope, day: "2027-04-0" + (index + 1) }, { singletonKey: randomUUID() });
     await boss.send("watch-send-dead", { ...scope, alert: randomUUID() });
    }
    const count = scope => w.pool.query("SELECT count(*)::integer AS n FROM pgboss.job WHERE data->>'account'=$1", [scope.account]).then(result => result.rows[0].n);
    assert.equal(await count(a), 18);
    assert.equal(await retryTransaction(w.pool, client => deleteScopedJobs(client, a)), 18);
    assert.equal(await count(a), 0);
    assert.equal(await count(b), 18);
   } finally { await boss.stop({ graceful: false, timeout: 2000 }).catch(() => undefined); }

   const quiet = await w.seedWatch();
   w.state.pence = 5400;
   const pending = await w.watches().check(job(quiet, "2027-03-02"));
   assert.ok(pending.alert);
   const mailless = new Watches({ pool: w.pool, delivery: fixtureDelivery({ SCOAT_FIXTURE_SELLER_PORT: String(w.sellerPort) }), config: w.config, enqueue: w.producer });
   await assert.rejects(mailless.send(send(quiet, pending.alert)), /Mail transport unavailable/);
   const untouched = (await w.pool.query("SELECT state,attempts,marked_at FROM watch_alerts WHERE id=$1", [pending.alert])).rows[0];
   assert.deepEqual({ state: untouched.state, attempts: untouched.attempts, marked: untouched.marked_at }, { state: "pending", attempts: 0, marked: null });
   const requestsBefore = (await w.requests()).length;
   await assert.rejects(startWorker({ databaseUrl: w.env.DATABASE_URL, config: w.config, delivery: fixtureDelivery({ SCOAT_FIXTURE_SELLER_PORT: String(w.sellerPort) }), concurrency: 1, initialPlan: true }), /requires a mail transport/);
   assert.equal((await w.requests()).length, requestsBefore);

   const post = (seeded, init) => fetch(w.f.issuer + "/watch/unsubscribe?token=" + signUnsubscribe(w.config, w.config.unsubscribe.version, seeded, seeded.watch), { method: "POST", ...init });
   const status = async seeded => (await w.pool.query("SELECT status FROM watches WHERE id=$1", [seeded.watch])).rows[0].status;
   const multipart = await w.seedWatch(), encoded = await w.seedWatch(), refused = await w.seedWatch();
   const many = (...pairs) => { const body = new FormData(); for (const [key, value] of pairs) body.append(key, value); return body; };
   const negatives = {
    duplicateMultipart: await post(refused, { body: many(["List-Unsubscribe", "One-Click"], ["List-Unsubscribe", "One-Click"]) }),
    extraMultipart: await post(refused, { body: many(["List-Unsubscribe", "One-Click"], ["extra", "x"]) }),
    wrongValue: await post(refused, { body: many(["List-Unsubscribe", "one-click"]) }),
    fileField: await post(refused, { body: many(["List-Unsubscribe", new Blob(["One-Click"])]) }),
    malformedMultipart: await post(refused, { headers: { "content-type": "multipart/form-data; boundary=scoat" }, body: "--scoat\r\nContent-Disposition: form-data; name=\"List-Unsubscribe\"\r\n\r\nOne-Click" }),
    duplicateEncoded: await post(refused, { headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click&List-Unsubscribe=One-Click" }),
    extraEncoded: await post(refused, { headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click&x=1" }),
    oversized: await post(refused, { headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click&pad=" + "x".repeat(5000) }),
    plainText: await post(refused, { headers: { "content-type": "text/plain" }, body: "List-Unsubscribe=One-Click" }),
   };
   for (const [name, response] of Object.entries(negatives)) assert.equal(response.status, 400, name);
   assert.equal(await status(refused), "active");
   const viaMultipart = await post(multipart, { body: many(["List-Unsubscribe", "One-Click"]) });
   assert.equal(viaMultipart.status, 200);
   assert.match(await viaMultipart.text(), /Watch stopped/);
   assert.equal(viaMultipart.headers.get("cache-control"), "no-store");
   assert.equal(await status(multipart), "cancelled");
   const viaEncoded = await post(encoded, { headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
   assert.equal(viaEncoded.status, 200);
   assert.equal(await status(encoded), "cancelled");
  } finally { await w.close(); }
 });
});

test("production worker refuses a missing mail key before queue installation", async () => {
 await withDatabase(async url => {
  const root = await scratchDirectory("worker-mail-");
  await writeFile(root + "/watch.json", JSON.stringify({ issuer: "https://scoat.invalid", from: "Scoat <alerts@scoat.invalid>", unsubscribe: { version: "v1", keys: { v1: "a".repeat(64) } }, resendApiKey: null }));
  const admin = new pg.Pool({ connectionString: url });
  const queueState = async () => {
   const installed = (await admin.query("SELECT to_regclass('pgboss.job') AS job, to_regclass('pgboss.schedule') AS schedule")).rows[0];
   return { installed: installed.job !== null, jobs: installed.job === null ? 0 : (await admin.query("SELECT count(*)::integer AS n FROM pgboss.job")).rows[0].n, schedules: installed.schedule === null ? 0 : (await admin.query("SELECT count(*)::integer AS n FROM pgboss.schedule")).rows[0].n };
  };
  const before = await queueState().catch(async error => { await admin.end(); throw error; });
  const result = await promisify(execFile)(process.execPath, ["dist/worker.js"], { env: { ...process.env, DATABASE_URL: url, SCOAT_WATCH_CONFIG: root + "/watch.json" }, timeout: 20000 }).then(() => ({ code: 0, stderr: "" }), error => ({ code: error.code, stderr: String(error.stderr) }));
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /requires resendApiKey/);
  try { assert.deepEqual(await queueState(), before); } finally { await admin.end(); await rm(root, { recursive: true, force: true }); }
 });
});
