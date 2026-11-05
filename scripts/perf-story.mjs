import assert from "node:assert/strict";
import os from "node:os";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { withDatabase } from "./durable-database.mjs";
import { watchFixture, productUrl } from "./watch-fixture.mjs";
import { storyConditions } from "./story-conditions.mjs";
import { confirm } from "./memory-lanes.mjs";

export const storyBudget = { huntMilliseconds: 5000, eligibleToOutboxMilliseconds: 5000, acceptancesPerAlert: 1 };
const sorted = values => [...values].sort((a, b) => a - b);
const quantile = (values, q) => sorted(values)[Math.min(values.length - 1, Math.floor(q * values.length))];
const summary = values => values.length ? { count: values.length, minMs: Math.min(...values), p50Ms: quantile(values, 0.5), p95Ms: quantile(values, 0.95), maxMs: Math.max(...values) } : { count: 0 };
const within = (promise, milliseconds, label) => { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + " exceeded " + milliseconds + " ms")), milliseconds); })]).finally(() => clearTimeout(timer)); };

async function scriptedHunt(call) {
 const calls = [];
 const timed = async (op, tool, args) => {
  const started = performance.now();
  const result = await call(tool, args);
  calls.push({ op, ms: performance.now() - started, isError: result.isError === true, ok: result.structuredContent?.ok === true });
  return result;
 };
 const started = performance.now();
 const opened = await timed("start", "scoat_hunt", { op: "start", requestKey: randomUUID(), profile: null, intent: { product: { kind: "url", url: productUrl }, variant: "4GB", shop: null, budget: null } });
 assert.ok(opened.structuredContent?.ok, JSON.stringify(opened).slice(0, 2000));
 let view = opened.structuredContent.value.view;
 const slots = view.rows.reduce((total, row) => total + row.slots.length, 0);
 assert.equal(view.rows.length, 8);
 assert.equal(slots, 11);
 let first = true;
 for (const row of view.rows) for (const slot of row.slots) {
  const current = view.rows.find(value => value.row.id === row.row.id);
  const proof = { url: productUrl, observedAt: new Date().toISOString(), note: "SYNTHETIC local Pi Hut fixture observation" };
  const base = { seller: "The Pi Hut", variant: "4GB", status: { kind: "confirmed" }, proof, validUntil: null };
  const outcome = first ? { kind: "found", offers: [{ ...base, kind: "price", amount: { currency: "GBP", pence: 6620 } }, { ...base, kind: "delivery", amount: { currency: "GBP", pence: 380 } }, { ...base, kind: "discount", status: { kind: "needs-step", steps: ["verify-student"] }, adjustment: { kind: "fixed", amount: { currency: "GBP", pence: 700 } }, code: null, codeOrigin: null, minimumSpend: { currency: "GBP", pence: 0 }, order: 0 }] } : { kind: "gap", reason: "SYNTHETIC unavailable" };
  const recorded = await timed("record", "scoat_hunt", { op: "record", requestKey: randomUUID(), hunt: view.hunt, row: row.row.id, slot: slot.slot, expected: current.revision, outcome });
  if (first && !recorded.structuredContent?.ok) { first = false; continue; }
  assert.ok(recorded.structuredContent?.ok, JSON.stringify(recorded).slice(0, 2000));
  view = recorded.structuredContent.value.view; first = false;
 }
 const ids = kind => view.offers.filter(item => item.kind === kind).map(item => item.id);
 const proof = [{ url: productUrl, observedAt: new Date().toISOString(), note: "SYNTHETIC local Pi Hut fixture compatibility" }];
 for (const offers of [[...ids("price"), ...ids("delivery")], [...ids("price"), ...ids("delivery"), ...ids("discount")]]) {
  const linked = await timed("compatibility", "scoat_hunt", { op: "compatibility", requestKey: randomUUID(), hunt: view.hunt, evidence: { offers, proof } });
  assert.ok(linked.structuredContent?.ok, JSON.stringify(linked).slice(0, 2000));
  view = linked.structuredContent.value.view;
 }
 const finished = await timed("finish", "scoat_hunt", { op: "finish", requestKey: randomUUID(), hunt: view.hunt, selection: null });
 assert.ok(finished.structuredContent?.ok, JSON.stringify(finished).slice(0, 2000));
 const read = await timed("read", "scoat_hunt", { op: "read", hunt: view.hunt });
 const huntMs = performance.now() - started;
 const canonical = read.structuredContent.value.view;
 const quote = canonical.final.quote;
 assert.equal(canonical.final.kind, "finished");
 assert.equal(quote.guaranteed.amount.pence, 7000);
 assert.equal(quote.conditional[0].payToday.amount.pence, 6300);
 assert.deepEqual(quote.conditional[0].requires, ["verify-student"]);
 assert.equal(canonical.progress.resolved, canonical.progress.total);
 assert.ok(canonical.ready?.url);
 const watchUrl = /Watch price: (\S+)/.exec(read.content[0].text)?.[1];
 assert.equal(watchUrl, read.structuredContent.controls.watch.url);
 return { hunt: canonical.hunt, huntMs, rows: canonical.rows.length, slots, watchUrl, calls, knownPence: quote.guaranteed.amount.pence, conditionalPence: quote.conditional[0].payToday.amount.pence };
}

async function persistedHunt(conditions, hunt) {
 const rows = await conditions.read("SELECT h.snapshot, (SELECT count(*) FROM hunt_rows r WHERE r.account=h.account AND r.incarnation=h.incarnation AND r.hunt=h.id)::integer AS rows FROM durable_hunts h WHERE h.id=$1", [hunt]);
 assert.equal(rows.length, 1);
 const snapshot = rows[0].snapshot;
 assert.ok(snapshot, "finish persisted no final HuntView");
 assert.equal(snapshot.hunt, hunt);
 assert.equal(snapshot.final.kind, "finished");
 assert.equal(snapshot.final.quote.guaranteed.amount.pence, 7000);
 assert.equal(snapshot.final.quote.conditional[0].payToday.amount.pence, 6300);
 assert.equal(rows[0].rows, 8);
 return { finalKind: snapshot.final.kind, knownPence: 7000, conditionalPence: 6300, persistedRows: rows[0].rows };
}

async function healthSamples(issuer, count) {
 const samples = [];
 let last = null;
 for (let n = 0; n < count; n++) {
  const started = performance.now();
  const response = await fetch(issuer + "/healthz");
  last = { status: response.status, body: await response.json() };
  samples.push(performance.now() - started);
 }
 return { samples, last };
}

export async function measureStory({ warmBatches = 5, huntsPerBatch = 3, healthPerBatch = 10 } = {}) {
 return withDatabase(async databaseUrl => {
  const fixture = await watchFixture(databaseUrl);
  const log = [];
  const conditions = storyConditions(fixture, entry => log.push({ at: new Date().toISOString(), kind: "synthetic-condition", ...entry }));
  let client = null;
  try {
   const role = (await conditions.read("SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user"))[0];
   const settings = (await conditions.read("SELECT current_setting('server_version') AS server_version, current_setting('synchronous_commit') AS synchronous_commit, current_setting('fsync') AS fsync, current_setting('shared_buffers') AS shared_buffers, current_setting('max_connections') AS max_connections, current_setting('default_transaction_isolation') AS default_transaction_isolation"))[0];
   const manifest = JSON.parse(await readFile("dist/release.json", "utf8")).digest;
   const worker = await conditions.worker.start();
   const startHealth = await healthSamples(fixture.f.issuer, 1);
   assert.equal(startHealth.last.status, 200);
   assert.equal(startHealth.last.body.ready, true, JSON.stringify(startHealth.last.body));
   assert.equal(startHealth.last.body.artifact.status, "verified");
   assert.equal(startHealth.last.body.artifact.digest, worker.artifact);
   assert.equal(manifest, worker.artifact);
   const login = await fixture.f.login("host-one");
   client = new Client({ name: "scoat-perf-p09", version: "1.0.0" });
   await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", fixture.f.issuer), { requestInit: { headers: { authorization: "Bearer " + login.token } } }));
   const call = (tool, args) => client.callTool({ name: tool, arguments: args });
   conditions.identity.setEmail({ email: "p09-perf-" + randomBytes(6).toString("hex") + "@example.test", email_verified: true });
   const batches = [];
   let plans = 0;
   for (let batch = 0; batch <= warmBatches; batch++) {
    const loadBefore = os.loadavg();
    const hunts = [];
    for (let n = 0; n < huntsPerBatch; n++) {
     const hunt = await scriptedHunt(call);
     hunts.push({ ...hunt, persisted: await persistedHunt(conditions, hunt.hunt) });
    }
    const watched = hunts.at(-1);
    conditions.seller.setPence(6620);
    const activationStarted = performance.now();
    const form = await confirm(fixture.f, watched.watchUrl, "/account/watch", "watch", false);
    form.body.set("target", "68.00");
    const activation = await fixture.f.browser(fixture.f.issuer + "/account/watch", { method: "POST", headers: { origin: fixture.f.issuer, "content-type": "application/x-www-form-urlencoded" }, body: form.body });
    const activationText = await activation.text();
    assert.equal(activation.status, 200, activationText.slice(0, 600));
    assert.ok(activationText.includes("Watch active"), activationText.slice(0, 600));
    const activationMs = performance.now() - activationStarted;
    const item = (await call("scoat_memory", { op: "read", collection: "watches" })).structuredContent.items.find(value => value.hunt === watched.hunt);
    assert.equal(item.status, "active");
    assert.equal(item.baseline.pence, 7000);
    conditions.seller.setPence(5620);
    const hitsBefore = conditions.seller.hits();
    const accepted = conditions.mail.next();
    const tickStarted = performance.now();
    await conditions.schedule.tick();
    plans++;
    const delivery = await within(accepted, 30000, "local mail acceptance");
    const tickToAcceptedMs = performance.now() - tickStarted;
    await conditions.settle({ plans });
    const outbox = await conditions.read(`SELECT a.id::text AS alert, a.provider_key, a.state, (SELECT count(*) FROM watch_alerts x WHERE x.watch = o.watch)::integer AS alerts, extract(epoch FROM c.completed_on - o.observed_at) * 1000 AS eligible_to_outbox_ms, extract(epoch FROM a.created_at - o.observed_at) * 1000 AS observed_to_alert_row_ms, extract(epoch FROM c.completed_on - c.started_on) * 1000 AS check_job_ms, extract(epoch FROM s.started_on - c.completed_on) * 1000 AS outbox_to_send_start_ms, extract(epoch FROM s.completed_on - s.started_on) * 1000 AS send_job_ms FROM watch_observations o JOIN watch_alerts a ON a.id = o.alert JOIN ${fixture.queueSchema}.job c ON c.name = 'watch-check' AND c.state = 'completed' AND c.data->>'watch' = o.watch::text AND c.data->>'day' = o.day::text JOIN ${fixture.queueSchema}.job s ON s.name = 'watch-send' AND s.data->>'alert' = a.id::text WHERE o.watch::text = $1`, [item.watch]);
    assert.equal(outbox.length, 1, JSON.stringify(outbox));
    const row = outbox[0];
    assert.equal(row.alerts, 1);
    assert.equal(row.state, "accepted");
    assert.equal(delivery.accepted, row.provider_key);
    batches.push({
     batch, warmup: batch === 0, loadBefore, loadAfter: os.loadavg(),
     hunts: hunts.map(({ hunt, huntMs, rows, slots, calls, persisted }) => ({ hunt, huntMs, rows, slots, mcpCalls: calls.length, errors: calls.filter(item => item.isError).length, refused: calls.filter(item => !item.ok).length, callsMs: calls, persisted })),
     watch: { watch: item.watch, alert: row.alert, providerKey: row.provider_key, activationMs, tickToAcceptedMs, sellerFixtureRequests: conditions.seller.hits() - hitsBefore, eligibleToOutboxMs: Number(row.eligible_to_outbox_ms), observedToAlertRowMs: Number(row.observed_to_alert_row_ms), checkJobMs: Number(row.check_job_ms), outboxToSendStartMs: Number(row.outbox_to_send_start_ms), sendJobMs: Number(row.send_job_ms) },
     health: await healthSamples(fixture.f.issuer, healthPerBatch).then(({ samples, last }) => ({ samplesMs: samples, status: last.status, ready: last.body.ready, digest: last.body.artifact.digest })),
     workerAlive: fixture.workerProcess()?.exitCode === null && fixture.workerProcess()?.signalCode === null,
    });
   }
   const deliveriesBefore = await conditions.mail.deliveries();
   const requestsBefore = (await conditions.mail.requests()).length;
   await conditions.schedule.tick();
   plans++;
   await conditions.settle({ plans });
   const deliveries = await conditions.mail.deliveries();
   const requests = (await conditions.mail.requests()).length;
   const perKey = deliveries.reduce((all, entry) => ({ ...all, [entry.key]: (all[entry.key] ?? 0) + 1 }), {});
   const alertKeys = batches.map(entry => entry.watch.providerKey).sort();
   const totals = (await conditions.read("SELECT count(*)::integer AS alerts, count(*) FILTER (WHERE state = 'accepted')::integer AS accepted, count(DISTINCT provider_key)::integer AS keys FROM watch_alerts"))[0];
   const finalHealth = await healthSamples(fixture.f.issuer, 1);
   return {
    role, settings, manifest, workerDigest: worker.artifact, startHealth: startHealth.last.body, finalHealth: finalHealth.last.body,
    batches,
    repeat: { deliveriesBefore: deliveriesBefore.length, deliveriesAfter: deliveries.length, requestsBefore, requestsAfter: requests, maxAcceptancesPerKey: Math.max(...Object.values(perKey)), deliveredKeys: Object.keys(perKey).sort(), alertKeys, totals },
    fixtureCounts: { hunts: batches.length * huntsPerBatch, watches: batches.length, rowsPerHunt: 8, slotsPerHunt: 11, plans, workerConcurrency: 4, mcpClients: 1 },
    conditions: log,
   };
  } finally {
   if (client) await client.close().catch(() => undefined);
   await fixture.close();
  }
 });
}

export function judgeStory(result) {
 const warm = result.batches.filter(batch => !batch.warmup);
 const huntMs = warm.flatMap(batch => batch.hunts.map(hunt => hunt.huntMs));
 const outboxMs = warm.map(batch => batch.watch.eligibleToOutboxMs);
 const errors = warm.flatMap(batch => batch.hunts).reduce((total, hunt) => total + hunt.errors, 0);
 const byOp = {};
 for (const call of warm.flatMap(batch => batch.hunts.flatMap(hunt => hunt.callsMs))) { byOp[call.op] ??= { calls: 0, totalMs: 0 }; byOp[call.op].calls++; byOp[call.op].totalMs += call.ms; }
 const limiting = Object.entries(byOp).sort((a, b) => b[1].totalMs - a[1].totalMs)[0];
 const repeat = result.repeat;
 const checks = {
  warmBatches: warm.length >= 5,
  huntBudget: huntMs.length > 0 && Math.max(...huntMs) <= storyBudget.huntMilliseconds,
  eligibleToOutboxBudget: outboxMs.length === warm.length && Math.max(...outboxMs) <= storyBudget.eligibleToOutboxMilliseconds,
  checkJobWithinOutboxBudget: warm.every(batch => batch.watch.checkJobMs <= storyBudget.eligibleToOutboxMilliseconds),
  noProtocolErrors: errors === 0,
  persistedFinalViews: result.batches.every(batch => batch.hunts.every(hunt => hunt.persisted.finalKind === "finished" && hunt.persisted.persistedRows === 8)),
  oneAcceptancePerAlert: repeat.maxAcceptancesPerKey <= storyBudget.acceptancesPerAlert && JSON.stringify(repeat.deliveredKeys) === JSON.stringify(repeat.alertKeys) && repeat.totals.alerts === result.batches.length && repeat.totals.accepted === result.batches.length && repeat.totals.keys === result.batches.length,
  repeatTickAddsNothing: repeat.deliveriesAfter === repeat.deliveriesBefore && repeat.requestsAfter === repeat.requestsBefore,
  readiness: result.startHealth.ready === true && result.finalHealth.ready === true && result.startHealth.artifact.digest === result.workerDigest && result.manifest === result.workerDigest && result.batches.every(batch => batch.health.status === 200 && batch.health.ready === true && batch.health.digest === result.workerDigest),
  workerHealth: result.batches.every(batch => batch.workerAlive),
 };
 return {
  pass: Object.values(checks).every(Boolean), checks,
  huntMs: summary(huntMs), eligibleToOutboxMs: summary(outboxMs),
  tickToAcceptedMs: summary(warm.map(batch => batch.watch.tickToAcceptedMs)), checkJobMs: summary(warm.map(batch => batch.watch.checkJobMs)), activationMs: summary(warm.map(batch => batch.watch.activationMs)),
  healthMs: summary(warm.flatMap(batch => batch.health.samplesMs)),
  hunt: { errors, byOp, limitingOperation: limiting ? { op: limiting[0], ...limiting[1], shareOfHuntMs: limiting[1].totalMs / huntMs.reduce((a, b) => a + b, 0) } : null },
 };
}
