import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { PgBoss } from "pg-boss";
import { withDatabase } from "../scripts/durable-database.mjs";
import { watchFixture } from "../scripts/watch-fixture.mjs";
import { fixtureDelivery } from "../scripts/watch-delivery.mjs";
import { scratchDirectory } from "../scripts/scratch.mjs";
import { retryTransaction } from "../dist/db/transaction.js";
import { deleteScopedJobs, queueNames, queueSchemaFor } from "../dist/queue/index.js";
import { Watches, deleteWatches, signUnsubscribe } from "../dist/memory/watches.js";
import { startWorker } from "../dist/worker.js";
import { admit } from "../dist/db/lineage.js";

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
   const planner = new Watches({ admitted: await admit(counted, "worker"), delivery: w.delivery, config: w.config, enqueue: w.producer });
   connects = 0;
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

   const boss = new PgBoss({ connectionString: w.env.DATABASE_URL, schema: w.queueSchema, schedule: false, supervise: false, migrate: false });
   await boss.start();
   try {
    await boss.createQueue("watch-send-dead");
    const make = () => ({ account: randomUUID(), incarnation: randomUUID(), watch: randomUUID() });
    const a = make(), b = make();
    for (const scope of [a, b]) for (const [index, state] of ["created", "retry", "active", "completed", "failed", "cancelled"].entries()) {
     const id = await boss.send(queueNames.send, { ...scope, alert: randomUUID() }, { singletonKey: randomUUID() });
     if (state !== "created") await w.pool.query(`UPDATE ${w.queueSchema}.job SET state=$1::${w.queueSchema}.job_state WHERE id=$2`, [state, id]);
     await boss.send(queueNames.check, { ...scope, day: "2027-04-0" + (index + 1) }, { singletonKey: randomUUID() });
     await boss.send("watch-send-dead", { ...scope, alert: randomUUID() });
    }
    const count = scope => w.pool.query(`SELECT count(*)::integer AS n FROM ${w.queueSchema}.job WHERE data->>'account'=$1`, [scope.account]).then(result => result.rows[0].n);
    assert.equal(await count(a), 18);
    assert.equal(await retryTransaction(w.pool, client => deleteScopedJobs(client, a)), 18);
    assert.equal(await count(a), 0);
    assert.equal(await count(b), 18);
   } finally { await boss.stop({ graceful: false, timeout: 2000 }).catch(() => undefined); }

   const quiet = await w.seedWatch();
   w.state.pence = 5400;
   const pending = await w.watches().check(job(quiet, "2027-03-02"));
   assert.ok(pending.alert);
   const mailless = new Watches({ admitted: w.admitted, delivery: fixtureDelivery({ SCOAT_FIXTURE_SELLER_PORT: String(w.sellerPort) }), config: w.config, enqueue: w.producer });
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

test("planning reaches every account beyond 1000 and every due watch beyond 5000", async () => {
 await withDatabase(async url => {
  const w = await watchFixture(url);
  try {
   const base = await w.seedWatch();
   const accounts = Array.from({ length: 1001 }, () => "0" + randomUUID().slice(1));
   const incarnations = accounts.map(() => randomUUID());
   await w.pool.query("INSERT INTO hunt_accounts(account,incarnation) SELECT * FROM unnest($1::text[],$2::uuid[])", [accounts, incarnations]);
   await w.pool.query("INSERT INTO watches(account,incarnation,id,hunt,target,basis,basis_digest,baseline_pence,baseline_observed_at,target_pence,recipient_revision,key_version) SELECT a.account,a.incarnation,gen_random_uuid(),'page-'||gen_random_uuid(),w.target,w.basis,w.basis_digest,w.baseline_pence,w.baseline_observed_at,w.target_pence,w.recipient_revision,w.key_version FROM watches w, unnest($1::text[],$2::uuid[]) a(account,incarnation), generate_series(1,6) WHERE w.id=$3", [accounts, incarnations, base.watch]);
   const tail = await w.seedWatch({ account: "ffffffff-ffff-4fff-8fff-fffffffffff1" });
   const expired = await w.seedWatch({ account: "ffffffff-ffff-4fff-8fff-fffffffffff0" });
   await w.pool.query("UPDATE watches SET expires_at=now()-interval '1 minute' WHERE id=$1", [expired.watch]);
   w.state.pence = 5000;
   const alert = await w.watches().check(job(tail, "2027-04-01"));
   assert.ok(alert.alert);
   await w.pool.query("UPDATE watch_alerts SET deadline=now()-interval '1 minute' WHERE id=$1", [alert.alert]);
   const checks = new Set(), sends = new Set();
   const planner = new Watches({ admitted: w.admitted, delivery: w.delivery, config: w.config, enqueue: { check: async (_client, value) => { checks.add(value.watch); }, send: async (_client, value) => { sends.add(value.alert); } } });
   const planned = await planner.plan();
   const expected = (await w.pool.query("SELECT id FROM watches WHERE status='active'")).rows.map(row => row.id);
   assert.equal(checks.has(tail.watch), true);
   assert.equal(expected.length, 6008);
   assert.deepEqual(checks, new Set(expected));
   assert.equal(planned.checks, expected.length);
   assert.equal(planned.expired, 1);
   assert.equal(sends.size, 0);
   assert.equal((await w.pool.query("SELECT status FROM watches WHERE id=$1", [expired.watch])).rows[0].status, "expired");
   assert.equal((await w.pool.query("SELECT state FROM watch_alerts WHERE id=$1", [alert.alert])).rows[0].state, "cancelled");
  } finally { await w.close(); }
 });
});

test("production worker refuses a missing mail key before database access", async () => {
 const root = await scratchDirectory("worker-mail-");
 let connections = 0;
 const database = createServer(socket => { connections++; socket.destroy(); });
 try {
  await new Promise(resolve => database.listen(0, "127.0.0.1", resolve));
  const address = database.address();
  assert.ok(address && typeof address === "object");
  const url = "postgres://unused:unused@127.0.0.1:" + address.port + "/unused";
  await writeFile(root + "/watch.json", JSON.stringify({ issuer: "https://scoat.invalid", from: "Scoat <alerts@scoat.invalid>", unsubscribe: { version: "v1", keys: { v1: "a".repeat(64) } }, resendApiKey: null }));
  const result = await promisify(execFile)(process.execPath, ["dist/worker.js"], { env: { ...process.env, DATABASE_URL: url, SCOAT_WATCH_CONFIG: root + "/watch.json" }, timeout: 20000 }).then(() => ({ code: 0, stderr: "" }), error => ({ code: error.code, stderr: String(error.stderr) }));
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /requires resendApiKey/);
  assert.equal(connections, 0);
 } finally {
  await new Promise(resolve => database.close(resolve));
  await rm(root, { recursive: true, force: true });
 }
});

test("unconfigured mail refuses browser and MCP activation while existing watches can still stop", async () => {
 await withDatabase(async url => {
  const w = await watchFixture(url, { mailConfigured: false });
  try {
   const login = await w.f.login();
   const principal = await w.f.authenticate(login.token);
   const scope = { account: principal.agent.account, incarnation: principal.agent.incarnation };
   const watches = w.watches();
   const response = await fetch(w.f.issuer + "/account/watch?account=" + scope.account + "&hunt=unconfigured", { redirect: "manual" });
   assert.equal(response.status, 503);
   assert.equal(response.headers.get("cache-control"), "no-store");
   assert.match(await response.text(), /Price watches are not configured/);
   const proposed = await w.f.tool(login.token, "scoat_memory", { op: "watch", requestKey: randomUUID(), hunt: "unconfigured", target: { currency: "GBP", pence: 6000 } });
   assert.equal(proposed.structuredContent.reason, "service-unconfigured");
   assert.equal((await w.pool.query("SELECT count(*)::integer AS n FROM watches")).rows[0].n, 0);
   assert.equal(watches.available, false);
   assert.deepEqual(await watches.prepare(scope, "unconfigured"), { kind: "unavailable", reason: "service-unconfigured" });
   await assert.rejects(retryTransaction(w.pool, client => watches.activate(client, { scope })), error => error.reason === "service-unconfigured");
   const seeded = await w.seedWatch(scope);
   const stopped = await w.f.tool(login.token, "scoat_memory", { op: "unwatch", requestKey: randomUUID(), watch: seeded.watch });
   assert.equal(stopped.structuredContent.kind, "unwatched");
   assert.equal((await w.pool.query("SELECT status FROM watches WHERE id=$1", [seeded.watch])).rows[0].status, "cancelled");
  } finally { await w.close(); }
 });
});

test("closing one watch fixture preserves another fixture's queued jobs in the same database", async () => {
 const certificates = getCACertificates("default");
 try {
  await withDatabase(async url => {
   const first = await watchFixture(url);
   let second;
   let firstClosed = false;
   try {
    second = await watchFixture(url);
    const seeded = await second.seedWatch();
    await retryTransaction(second.pool, client => second.producer.check(client, job(seeded, "2027-04-01")));
    await first.close();
    firstClosed = true;
    await retryTransaction(second.pool, client => second.producer.check(client, job(seeded, "2027-04-02")));
    const queued = await second.pool.query(`SELECT count(*)::integer AS n FROM ${second.queueSchema}.job WHERE data->>'watch'=$1`, [seeded.watch]);
    assert.equal(queued.rows[0].n, 2);
    assert.notEqual(first.queueSchema, second.queueSchema);
    assert.notEqual(second.queueSchema, "pgboss");
    assert.equal(await retryTransaction(second.pool, async client => {
     await client.query("SET LOCAL search_path=public");
     return queueSchemaFor(client);
    }), "pgboss");
    assert.equal(await retryTransaction(second.pool, client => deleteScopedJobs(client, seeded)), 2);
   } finally {
    if (!firstClosed) await first.close();
    await second?.close();
   }
  });
 } finally { setDefaultCACertificates(certificates); }
});
