import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { watchFixture, productUrl, variant } from "./watch-fixture.mjs";
import { serveCard } from "./card-fixture.mjs";
import { retryTransaction } from "../dist/db/transaction.js";
import { eraseAccount } from "../dist/accounts/erasure.js";

const day = n => new Date(Date.UTC(2027, 0, n)).toISOString().slice(0, 10);
const html = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;");

export async function watchLanes(databaseUrl, evidence, head) {
 const w = await watchFixture(databaseUrl);
 const { f, pool, state } = w;
 const browser = await chromium.launch();
 const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 760 } });
 const page = await context.newPage();
 const lanes = {};
 const shot = async (name, transcript) => {
  await writeFile(path.join(evidence, name + ".json"), JSON.stringify(transcript, null, 1));
  const view = await context.newPage();
  await view.setContent(`<title>${name}</title><body style="font:13px system-ui;margin:20px"><h2>${name} at ${html(head)}</h2><pre style="white-space:pre-wrap">${html(JSON.stringify(transcript, null, 1).slice(0, 9000))}</pre></body>`);
  await view.screenshot({ path: path.join(evidence, name + ".png"), fullPage: true });
  await view.close();
 };
 const counts = async scope => Object.fromEntries(await Promise.all(["watches", "watch_alerts", "watch_observations", "watch_recipients"].map(async table => [table, (await pool.query(`SELECT count(*)::integer AS n FROM ${table} WHERE account=$1 AND incarnation=$2`, [scope.account, scope.incarnation])).rows[0].n])));
 const jobs = async filter => (await pool.query("SELECT name,state::text AS state FROM pgboss.job WHERE data @> $1::jsonb ORDER BY name,state", [JSON.stringify(filter)])).rows;
 const alerts = async watch => (await pool.query("SELECT id,state,amount_pence,provider_key,attempts,last_error,day::text AS day FROM watch_alerts WHERE watch=$1 ORDER BY created_at", [watch])).rows;
 const jobFor = (scope, watch, n) => ({ account: scope.account, incarnation: scope.incarnation, watch, day: day(n) });
 const sendFor = (scope, watch, alert) => ({ account: scope.account, incarnation: scope.incarnation, watch, alert });
 try {
  const login = await f.login();
  const principal = await f.authenticate(login.token);
  const scope = { account: principal.agent.account, incarnation: principal.agent.incarnation };
  const memory = async request => { const result = await f.tool(login.token, "scoat_memory", request); assert.ok(!result.isError, JSON.stringify(result)); return result.structuredContent; };
  const finishedHunt = async (withStudent) => {
   const start = await f.tool(login.token, "scoat_hunt", { op: "start", requestKey: randomUUID(), profile: null, intent: { product: { kind: "url", url: productUrl }, variant: "4GB", shop: null, budget: null } });
   assert.ok(start.structuredContent.ok, JSON.stringify(start));
   let view = start.structuredContent.value.view;
   let first = withStudent;
   for (const row of view.rows) for (const slot of row.slots) {
    const current = view.rows.find(value => value.row.id === row.row.id);
    const proof = { url: productUrl, observedAt: new Date().toISOString(), note: "SYNTHETIC local Pi Hut fixture observation" };
    const base = { seller: "The Pi Hut", variant: "4GB", status: { kind: "confirmed" }, proof, validUntil: null };
    const outcome = first ? { kind: "found", offers: [{ ...base, kind: "price", amount: { currency: "GBP", pence: 6620 } }, { ...base, kind: "delivery", amount: { currency: "GBP", pence: 380 } }, { ...base, kind: "discount", status: { kind: "needs-step", steps: ["verify-student"] }, adjustment: { kind: "fixed", amount: { currency: "GBP", pence: 700 } }, code: null, codeOrigin: null, minimumSpend: { currency: "GBP", pence: 0 }, order: 0 }] } : { kind: "gap", reason: "SYNTHETIC unavailable" };
    const record = await f.tool(login.token, "scoat_hunt", { op: "record", requestKey: randomUUID(), hunt: view.hunt, row: row.row.id, slot: slot.slot, expected: current.revision, outcome });
    if (first && !record.structuredContent?.ok) { first = false; continue; }
    assert.ok(record.structuredContent.ok, JSON.stringify(record)); view = record.structuredContent.value.view; first = false;
   }
   if (withStudent) {
    const ids = kind => (view.offers ?? []).filter(item => item.kind === kind).map(item => item.id);
    const proof = [{ url: productUrl, observedAt: new Date().toISOString(), note: "SYNTHETIC local Pi Hut fixture compatibility" }];
    for (const offers of [[...ids("price"), ...ids("delivery")], [...ids("price"), ...ids("delivery"), ...ids("discount")]]) {
     const linked = await f.tool(login.token, "scoat_hunt", { op: "compatibility", requestKey: randomUUID(), hunt: view.hunt, evidence: { offers, proof } });
     assert.ok(linked.structuredContent?.ok, JSON.stringify(linked));
     view = linked.structuredContent.value.view;
    }
   }
   const finished = await f.tool(login.token, "scoat_hunt", { op: "finish", requestKey: randomUUID(), hunt: view.hunt, selection: null });
   assert.ok(finished.structuredContent.ok, JSON.stringify(finished));
   return { hunt: view.hunt, text: finished.structuredContent.value.view?.text ?? view.text };
  };
  const huntA = await finishedHunt(true);
  const studentShown = /GBP 63\.00/.test(huntA.text);
  assert.ok(studentShown, huntA.text.slice(0, 1500));
  const proposalA = await memory({ op: "watch", requestKey: randomUUID(), hunt: huntA.hunt, target: { currency: "GBP", pence: 6000 } });
  assert.equal(proposalA.kind, "confirmation-required");
  assert.equal(proposalA.url, f.issuer + "/account/watch?account=" + encodeURIComponent(scope.account) + "&hunt=" + encodeURIComponent(huntA.hunt));
  f.setEmail({ email: "person@example.test", email_verified: true });
  await page.goto(proposalA.url);
  await page.getByText("Confirm price watch").waitFor();
  const confirmText = await page.locator("body").innerText();
  assert.match(confirmText, /Public delivered baseline\s*GBP 70\.00/);
  assert.match(confirmText, /p\*\*\*@example\.test/);
  assert.ok(!confirmText.includes("63.00"));
  assert.equal(await page.getByLabel("Your target delivered price (GBP)").inputValue(), "60.00");
  await page.screenshot({ path: path.join(evidence, "p08-review-1-confirm.png"), fullPage: true });
  await page.getByRole("button", { name: "Start watching" }).click();
  await page.getByText("Watch active").waitFor();
  await page.screenshot({ path: path.join(evidence, "p08-review-2-active.png"), fullPage: true });
  const replayed = await memory({ op: "read", collection: "watches" });
  const watchA = replayed.items[0];
  assert.equal(watchA.baseline.pence, 7000);
  assert.ok(!JSON.stringify(replayed).includes("person@example.test"));

  const refusals = {};
  for (const [name, claims] of [["unverified", { email: "person@example.test", email_verified: false }], ["missing", {}]]) {
   const proposal = await memory({ op: "watch", requestKey: randomUUID(), hunt: (await finishedHunt(false)).hunt, target: { currency: "GBP", pence: 6000 } });
   f.setEmail(claims);
   await page.goto(proposal.url);
   await page.getByText("Verified email required").waitFor();
   refusals[name] = { page: (await page.locator("body").innerText()).slice(0, 200), active: (await memory({ op: "read", collection: "watches" })).items.filter(item => item.status === "active").length };
  }
  f.setEmail({ email: "person@example.test", email_verified: true });
  const staleHunt = await finishedHunt(false);
  const stale = await memory({ op: "watch", requestKey: randomUUID(), hunt: staleHunt.hunt, target: { currency: "GBP", pence: 6000 } });
  await page.goto(stale.url);
  await page.getByText("Confirm price watch").waitFor();
  await pool.query("UPDATE oauth_browser_flows SET data=jsonb_set(data,'{context,observedAt}',to_jsonb((data->'context'->>'observedAt')::bigint-180000)) WHERE data->'context'->>'stage'='watch-confirm'");
  await page.getByRole("button", { name: "Start watching" }).click();
  await page.waitForLoadState();
  refusals.stale = { status: (await page.locator("body").innerText()).slice(0, 120), active: (await memory({ op: "read", collection: "watches" })).items.filter(item => item.status === "active").length };
  const foreign = await fetch(f.issuer + "/account/watch", { method: "POST", headers: { origin: "https://attacker.invalid", "content-type": "application/x-www-form-urlencoded" }, body: "confirmation=x&decision=watch" });
  refusals.foreignOrigin = foreign.status;
  assert.match(refusals.stale.status, /Price watch not started/);
  assert.ok(await page.getByRole("link", { name: "Start again with a fresh public price" }).count());
  const nativePost = async values => {
   await page.evaluate(entries => { const form = document.createElement("form"); form.method = "post"; form.action = "/account/watch"; for (const [name, value] of entries) { const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.append(input); } document.body.append(form); form.submit(); }, values);
   await page.waitForLoadState();
   return (await page.locator("body").innerText()).slice(0, 300);
  };
  refusals.expired = await nativePost([["confirmation", randomBytes(32).toString("base64url")], ["decision", "watch"], ["target", "60.00"]]);
  assert.match(refusals.expired, /expired or was already used/);
  await page.goto(proposalA.url);
  refusals.alreadyWatching = (await page.locator("body").innerText()).slice(0, 300);
  assert.match(refusals.alreadyWatching, /already has an active price watch/);
  await pool.query("INSERT INTO watches(account,incarnation,id,hunt,target,basis,basis_digest,baseline_pence,baseline_observed_at,target_pence,recipient_revision,key_version) SELECT account,incarnation,gen_random_uuid(),'limit-'||g,target,basis,basis_digest,baseline_pence,baseline_observed_at,target_pence,recipient_revision,key_version FROM watches, generate_series(1,9) g WHERE id=$1", [watchA.watch]);
  const limitHunt = await finishedHunt(false);
  const limitLink = (await f.tool(login.token, "scoat_hunt", { op: "read", hunt: limitHunt.hunt })).structuredContent.controls.watch;
  assert.equal(limitLink.available, true);
  await page.goto(limitLink.url);
  refusals.limit = (await page.locator("body").innerText()).slice(0, 300);
  assert.match(refusals.limit, /maximum number of active price watches/);
  refusals.limitProposal = await memory({ op: "watch", requestKey: randomUUID(), hunt: limitHunt.hunt, target: { currency: "GBP", pence: 6000 } });
  assert.equal(refusals.limitProposal.reason, "watch-limit");
  await pool.query("UPDATE watches SET status='cancelled',ended_at=now() WHERE account=$1 AND hunt LIKE 'limit-%'", [scope.account]);
  await page.screenshot({ path: path.join(evidence, "p08-review-0-refusal.png"), fullPage: true });
  assert.equal(refusals.unverified.active, 1); assert.equal(refusals.missing.active, 1); assert.equal(refusals.stale.active, 1); assert.equal(foreign.status, 403);

  await w.startWorker();
  const checker = w.watches();
  state.pence = 5620;
  const lane1 = await checker.check(jobFor(scope, watchA.watch, 1));
  assert.ok(lane1.alert);
  const delivered1 = await w.waitAccepted((await alerts(watchA.watch))[0].provider_key);
  assert.equal(await checker.send(sendFor(scope, watchA.watch, lane1.alert)), "settled");
  const trunkContracts = execFileSync("git", ["show", "1e4039060ac5b2496a8d6a771c408d78cd3b65c3:src/memory/contracts.ts"], { encoding: "utf8" });
  const trunkDelivery = execFileSync("git", ["show", "1e4039060ac5b2496a8d6a771c408d78cd3b65c3:src/delivery/index.ts"], { encoding: "utf8" });
  lanes[1] = { trunk: { watchOperation: trunkContracts.includes('"watch"'), deliveryThrows: trunkDelivery.includes('throw new Error("not implemented")'), result: "feature absent on trunk; no due-watch scenario can run" }, head: { proposal: proposalA.kind, observation: lane1.observation, alert: lane1.alert, alerts: await alerts(watchA.watch), delivered: delivered1 } };
  assert.equal(lanes[1].head.alerts.filter(a => a.state === "accepted").length, 1);
  await shot("p08-lane-1", lanes[1]);

  const basis = (await pool.query("SELECT basis_digest,basis FROM watches WHERE id=$1", [watchA.watch])).rows[0];
  const { basisDigest } = await import("../dist/delivery/index.js");
  lanes[2] = { watchBasis: basis, observedBasisDigest: basisDigest(lane1.observation), identical: basis.basis_digest === basisDigest(lane1.observation), observation: lane1.observation };
  assert.ok(lanes[2].identical);
  await shot("p08-lane-2", lanes[2]);

  lanes[3] = { huntTextShowsPersonalizedScenario: studentShown, huntTextQuoteLines: huntA.text.split("\n").filter(line => /GBP/.test(line)), proposal: proposalA, activatedBaselinePence: watchA.baseline.pence, baselineSource: watchA.baseline.source, personalizedReused: watchA.baseline.pence === 6300 };
  assert.equal(lanes[3].personalizedReused, false);
  await shot("p08-lane-3", lanes[3]);

  const lane4 = [];
  for (const [n, mode] of [[2, "blocked"], [3, "variant-changed"], [4, "delivery-unknown"], [5, "private-redirect"]]) {
   state.mode = mode;
   const result = await checker.check(jobFor(scope, watchA.watch, n));
   lane4.push({ mode, observation: result.observation, alert: result.alert });
   assert.equal(result.observation.kind, "unknown"); assert.equal(result.alert, null);
  }
  state.mode = "ok"; state.available = false;
  const unavailable = await checker.check(jobFor(scope, watchA.watch, 6));
  lane4.push({ mode: "unavailable", observation: unavailable.observation, alert: unavailable.alert });
  state.available = true;
  lanes[4] = { results: lane4, alertsAfter: (await alerts(watchA.watch)).length };
  assert.equal(lanes[4].alertsAfter, 1);
  await shot("p08-lane-4", lanes[4]);

  const boundary = await w.seedWatch({ baselinePence: 7000, targetPence: 6000 });
  const above = await w.seedWatch({ baselinePence: 7000, targetPence: 8000 });
  const steps = [];
  for (const [n, pence, seeded] of [[1, 6001, boundary], [2, 6000, boundary], [3, 6000, boundary], [4, 5999, boundary], [5, 7000, above], [6, 6999, above]]) {
   state.pence = pence - 380;
   const result = await checker.check(jobFor(seeded, seeded.watch, n));
   steps.push({ delivered: pence, target: seeded === boundary ? 6000 : 8000, baseline: 7000, alert: Boolean(result.alert) });
  }
  lanes[5] = { steps, rule: "amount <= target AND amount < baseline AND amount < lowest prior reserved alert" };
  assert.deepEqual(steps.map(step => step.alert), [false, true, false, true, false, true]);
  await shot("p08-lane-5", lanes[5]);

  const concurrent = await w.seedWatch();
  state.pence = 5500;
  const same = jobFor(concurrent, concurrent.watch, 9);
  const raced = await Promise.all(Array.from({ length: 6 }, () => w.watches().check(same)));
  const singleton = await retryTransaction(pool, async client => { for (let n = 0; n < 3; n++) await w.producer.check(client, same); return true; });
  lanes[6] = { results: raced.map(result => result.kind + ":" + Boolean(result.alert)), observations: (await pool.query("SELECT count(*)::integer AS n FROM watch_observations WHERE watch=$1 AND day=$2", [concurrent.watch, same.day])).rows[0].n, alerts: (await alerts(concurrent.watch)).length, queuedChecks: (await jobs({ watch: concurrent.watch, day: same.day })).length, singletonEnqueue: singleton };
  assert.equal(lanes[6].observations, 1); assert.equal(lanes[6].alerts, 1); assert.ok(lanes[6].queuedChecks <= 1);
  await shot("p08-lane-6", lanes[6]);

  await w.killWorker("SIGTERM");
  await w.startWorker();
  const crash = await w.seedWatch();
  await w.hold(4000);
  state.pence = 5400;
  const crashCheck = await checker.check(jobFor(crash, crash.watch, 10));
  const acceptedCrash = await w.waitAccepted((await alerts(crash.watch))[0].provider_key);
  await w.killWorker("SIGKILL");
  await w.hold(0);
  const afterKill = await alerts(crash.watch);
  const retried = await w.watches().send(sendFor(crash, crash.watch, crashCheck.alert));
  const key = afterKill[0].provider_key;
  lanes[7] = { acceptedByProvider: acceptedCrash, stateAfterKill: afterKill[0].state, retry: retried, stateAfterRetry: (await alerts(crash.watch))[0].state, providerRequestsWithKey: (await w.requests()).filter(r => r.key === key).length, providerDeliveriesWithKey: (await w.deliveries()).filter(d => d.key === key).length, payloadDigests: [...new Set((await w.requests()).filter(r => r.key === key).map(r => r.digest))].length };
  assert.equal(lanes[7].stateAfterKill, "submitting"); assert.equal(lanes[7].retry, "accepted"); assert.equal(lanes[7].providerDeliveriesWithKey, 1); assert.ok(lanes[7].providerRequestsWithKey >= 2); assert.equal(lanes[7].payloadDigests, 1);
  await shot("p08-lane-7", lanes[7]);

  const { signUnsubscribe } = await import("../dist/memory/watches.js");
  const unsubscribe = async seeded => (await fetch(f.issuer + "/watch/unsubscribe?token=" + signUnsubscribe(w.config, w.config.unsubscribe.version, seeded, seeded.watch), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" })).text();
  const reserved = await w.seedWatch();
  state.pence = 5300;
  const reservedCheck = await checker.check(jobFor(reserved, reserved.watch, 11));
  const reservedJobsBefore = await jobs({ watch: reserved.watch });
  const stopped = await unsubscribe(reserved);
  const reservedSend = await checker.send(sendFor(reserved, reserved.watch, reservedCheck.alert));
  let release;
  const marked = await w.seedWatch();
  const markedCheck = await checker.check(jobFor(marked, marked.watch, 12));
  const paused = new Promise(resolve => { release = resolve; });
  let reached;
  const atMarker = new Promise(resolve => { reached = resolve; });
  const markedSend = w.watches(async point => { if (point === "marked") { reached(); await paused; } }).send(sendFor(marked, marked.watch, markedCheck.alert));
  await atMarker;
  const markedStop = await unsubscribe(marked);
  release();
  const markedOutcome = await markedSend;
  const fenced = await w.seedWatch();
  const fencedCheck = await checker.check(jobFor(fenced, fenced.watch, 13));
  let releaseFence, reachedFence;
  const fenceHeld = new Promise(resolve => { reachedFence = resolve; }), fenceGate = new Promise(resolve => { releaseFence = resolve; });
  const fencedSend = w.watches(async point => { if (point === "fenced") { reachedFence(); await fenceGate; } }).send(sendFor(fenced, fenced.watch, fencedCheck.alert));
  await fenceHeld;
  const fencedStop = unsubscribe(fenced);
  await new Promise(resolve => setTimeout(resolve, 500));
  const stopBlocked = (await pool.query("SELECT count(*)::integer AS n FROM pg_locks WHERE NOT granted")).rows[0].n;
  releaseFence();
  lanes[8] = {
   reserved: { jobsBefore: reservedJobsBefore, page: stopped.replace(/<[^>]+>/g, " ").trim(), jobsAfter: await jobs({ watch: reserved.watch }), alert: (await alerts(reserved.watch))[0], sendAfterUnsubscribe: reservedSend },
   markerCommitted: { page: markedStop.replace(/<[^>]+>/g, " ").trim(), sendOutcome: markedOutcome, alert: (await alerts(marked.watch))[0] },
   fencedSubmit: { waitingLocks: stopBlocked, sendOutcome: await fencedSend, page: (await fencedStop).replace(/<[^>]+>/g, " ").trim(), alert: (await alerts(fenced.watch))[0] },
   replay: (await unsubscribe(reserved)).replace(/<[^>]+>/g, " ").trim(),
  };
  assert.equal(lanes[8].reserved.alert.state, "cancelled"); assert.equal(lanes[8].reserved.jobsAfter.length, 0); assert.equal(lanes[8].reserved.sendAfterUnsubscribe, "settled");
  assert.match(lanes[8].markerCommitted.page, /may still arrive/); assert.equal(lanes[8].fencedSubmit.sendOutcome, "accepted"); assert.ok(lanes[8].fencedSubmit.waitingLocks >= 1); assert.match(lanes[8].replay, /not active/);
  await shot("p08-lane-8", lanes[8]);

  const keeper = await w.seedWatch();
  state.pence = 5200;
  const keeperCheck = await checker.check(jobFor(keeper, keeper.watch, 14));
  const erase = async seeded => retryTransaction(pool, async client => {
   const status = randomBytes(16).toString("hex");
   await client.query("INSERT INTO erase_status(digest,operation) VALUES($1,$2)", [status, randomUUID()]);
   return eraseAccount(client, seeded, f.config.lifecycleKey, f.config.lifecycleKeyVersion, status);
  });
  const gate = () => { let open, hit; const reached = new Promise(resolve => { hit = resolve; }); const opened = new Promise(resolve => { open = resolve; }); return { reached, open, hook: point => async at => { if (at === point) { hit(); await opened; } } }; };
  const lane9 = {};
  const enqueueGate = gate(), enqueueSeed = await w.seedWatch();
  state.pence = 5100;
  const enqueueCheck = w.watches(enqueueGate.hook("outbox")).check(jobFor(enqueueSeed, enqueueSeed.watch, 15));
  await enqueueGate.reached;
  const enqueueErase = erase(enqueueSeed);
  await new Promise(resolve => setTimeout(resolve, 300));
  enqueueGate.open();
  const enqueueResult = await enqueueCheck;
  lane9.enqueue = { checkCommittedFirst: Boolean(enqueueResult.alert), receipt: (await enqueueErase).retention.watchMail, jobs: (await enqueueErase).retention.jobs, survivors: await counts(enqueueSeed), queue: await jobs({ account: enqueueSeed.account }) };
  const reserveGate = gate(), reserveSeed = await w.seedWatch();
  const reserveAlert = await checker.check(jobFor(reserveSeed, reserveSeed.watch, 16));
  const reserveSend = w.watches(reserveGate.hook("marked")).send(sendFor(reserveSeed, reserveSeed.watch, reserveAlert.alert));
  await reserveGate.reached;
  const reserveReceipt = await erase(reserveSeed);
  reserveGate.open();
  lane9.reserve = { receipt: reserveReceipt.retention.watchMail, sendAfterErase: await reserveSend, survivors: await counts(reserveSeed), queue: await jobs({ account: reserveSeed.account }) };
  const sendGate = gate(), sendSeed = await w.seedWatch();
  const sendAlert = await checker.check(jobFor(sendSeed, sendSeed.watch, 17));
  const sendKey = (await alerts(sendSeed.watch))[0].provider_key;
  const sendRun = w.watches(sendGate.hook("fenced")).send(sendFor(sendSeed, sendSeed.watch, sendAlert.alert));
  await sendGate.reached;
  const sendErase = erase(sendSeed);
  await new Promise(resolve => setTimeout(resolve, 300));
  sendGate.open();
  lane9.send = { sendOutcome: await sendRun, receipt: (await sendErase).retention.watchMail, deliveriesWithKey: (await w.deliveries()).filter(d => d.key === sendKey).length, survivors: await counts(sendSeed) };
  const lossGate = gate(), lossSeed = await w.seedWatch();
  const lossAlert = await checker.check(jobFor(lossSeed, lossSeed.watch, 18));
  const lossRun = w.watches(lossGate.hook("submitted")).send(sendFor(lossSeed, lossSeed.watch, lossAlert.alert)).then(value => value, error => "connection-lost: " + error.message);
  await lossGate.reached;
  lane9.terminated = (await pool.query("SELECT pg_terminate_backend(pid) AS done FROM pg_stat_activity WHERE state='idle in transaction' AND query LIKE 'SELECT revision,address FROM watch_recipients%' AND pid<>pg_backend_pid()")).rows;
  lossGate.open();
  const lossOutcome = await lossRun;
  const lossReceipt = await erase(lossSeed);
  lane9.connectionLoss = { sendOutcome: lossOutcome, receipt: lossReceipt.retention.watchMail, survivors: await counts(lossSeed) };
  const lateSend = await w.watches().send(sendFor(lossSeed, lossSeed.watch, lossAlert.alert));
  lane9.lateOldJob = { outcome: lateSend, queue: await jobs({ account: lossSeed.account }) };
  lane9.otherAccountPreserved = { counts: await counts(keeper), alerts: (await alerts(keeper.watch)).length, queue: await jobs({ account: keeper.account }) };
  lanes[9] = lane9;
  for (const part of [lane9.enqueue, lane9.reserve, lane9.send, lane9.connectionLoss]) assert.deepEqual(part.survivors, { watches: 0, watch_alerts: 0, watch_observations: 0, watch_recipients: 0 });
  assert.equal(lane9.enqueue.queue.length, 0); assert.equal(lane9.reserve.sendAfterErase, "refused"); assert.equal(lane9.reserve.receipt.mayStillArrive, 1); assert.equal(lane9.send.sendOutcome, "accepted"); assert.equal(lane9.connectionLoss.receipt.mayStillArrive, 1); assert.equal(lane9.lateOldJob.outcome, "refused");
  assert.equal(lane9.otherAccountPreserved.counts.watches, 1); assert.ok(keeperCheck.alert);
  await shot("p08-lane-9", lanes[9]);

  const email = (await w.deliveries()).find(item => item.key === lanes[1].head.alerts[0].provider_key);
  const review = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 760 }, recordVideo: { dir: path.join(evidence, "video"), size: { width: 1100, height: 760 } } });
  const reviewPage = await review.newPage();
  const reviewHunt = await finishedHunt(false);
  const reviewProposal = await memory({ op: "watch", requestKey: randomUUID(), hunt: reviewHunt.hunt, target: { currency: "GBP", pence: 6000 } });
  state.pence = 6620;
  await reviewPage.goto(reviewProposal.url);
  await reviewPage.getByText("Confirm price watch").waitFor();
  await reviewPage.waitForTimeout(6000);
  await reviewPage.getByRole("button", { name: "Start watching" }).click();
  await reviewPage.getByText("Watch active").waitFor();
  await reviewPage.waitForTimeout(5000);
  await reviewPage.setContent(email.message.html);
  await reviewPage.screenshot({ path: path.join(evidence, "p08-review-3-email.png"), fullPage: true });
  await reviewPage.screenshot({ path: path.join(evidence, "p08-lane-10.png"), fullPage: true });
  await reviewPage.waitForTimeout(7000);
  const link = email.message.headers["List-Unsubscribe"].slice(1, -1);
  await reviewPage.goto(link);
  await reviewPage.getByText("Stop this price watch?").waitFor();
  await reviewPage.screenshot({ path: path.join(evidence, "p08-review-4-unsubscribe.png"), fullPage: true });
  await reviewPage.waitForTimeout(5000);
  await reviewPage.getByRole("button", { name: "Stop watching" }).click();
  await reviewPage.getByText("Watch stopped").waitFor();
  await reviewPage.screenshot({ path: path.join(evidence, "p08-review-5-stopped.png"), fullPage: true });
  await reviewPage.waitForTimeout(5000);
  await reviewPage.goto(link);
  await reviewPage.getByRole("button", { name: "Stop watching" }).click();
  await reviewPage.getByText("This watch is not active").waitFor();
  await reviewPage.screenshot({ path: path.join(evidence, "p08-review-6-replay.png"), fullPage: true });
  await reviewPage.waitForTimeout(4000);
  const video = await reviewPage.video().path();
  await review.close();
  lanes[10] = { to: email.message.to, subject: email.message.subject, text: email.message.text, headers: email.message.headers, video, unsubscribeWorked: (await memory({ op: "read", collection: "watches" })).items.find(item => item.watch === watchA.watch).status };
  for (const part of ["GBP 60.00", "GBP 56.20", "GBP 3.80", "Observed at", productUrl, "Conditions", "/watch/unsubscribe?token="]) assert.ok(email.message.text.includes(part), part);
  assert.equal(lanes[10].unsubscribeWorked, "cancelled");
  await writeFile(path.join(evidence, "p08-lane-10.json"), JSON.stringify(lanes[10], null, 1));

  const huntC = await finishedHunt(false);
  const readC = await f.tool(login.token, "scoat_hunt", { op: "read", hunt: huntC.hunt });
  const textUrl = /Watch price: (\S+)/.exec(readC.content[0].text)?.[1];
  assert.ok(textUrl);
  assert.equal(textUrl, readC.structuredContent.controls.watch.url);
  const card = await serveCard(f, login, readC.structuredContent);
  const cardPage = await context.newPage();
  try {
   await cardPage.goto(card.url);
   const cardFrame = cardPage.frameLocator("iframe");
   f.setEmail({ email: "person.work@example.test", email_verified: true });
   const [popup] = await Promise.all([cardPage.waitForEvent("popup"), cardFrame.getByRole("button", { name: "Watch price" }).click()]);
   await popup.getByText("Confirm price watch").waitFor();
   const opened = (await cardPage.evaluate(() => window.harness.opened))[0];
   assert.equal(opened, textUrl);
   await cardPage.screenshot({ path: path.join(evidence, "p08-review-7-card.png"), fullPage: true });
   const moveText = await popup.locator("body").innerText();
   assert.match(moveText, /verified a different address\. Your 1 other active watch alerts p\*\*\*@example\.test now/);
   assert.equal(await popup.getByLabel("Your target delivered price (GBP)").inputValue(), "");
   await popup.getByLabel("Your target delivered price (GBP)").fill("60.00");
   await popup.getByRole("button", { name: "Start watching" }).click();
   const blocked = await popup.evaluate(() => document.querySelector("input[name=recipient]").validity.valueMissing);
   assert.equal(blocked, true);
   assert.equal(await popup.title(), "Confirm Scoat price watch");
   await popup.screenshot({ path: path.join(evidence, "p08-review-8-move-consent.png"), fullPage: true });
   await popup.getByLabel(/Send alerts for all my watches/).check();
   await popup.getByRole("button", { name: "Start watching" }).click();
   await popup.getByText("Watch active").waitFor();
   const activeText = await popup.locator("body").innerText();
   assert.match(activeText, /Alerts for your 1 other active watch now go to the same verified address/);
   await popup.screenshot({ path: path.join(evidence, "p08-review-9-moved.png"), fullPage: true });
   await popup.close();
  } finally { await cardPage.close(); await card.close(); }
  const moved = (await memory({ op: "read", collection: "watches" })).items.filter(item => item.status === "active");
  assert.equal(moved.length, 2);
  assert.ok(moved.every(item => item.alertsCurrentRecipient));
  const earlier = moved.find(item => item.hunt === reviewHunt.hunt);
  assert.ok(earlier);
  state.pence = 5320;
  const drop = await checker.check(jobFor(scope, earlier.watch, 40));
  assert.ok(drop.alert);
  const movedSend = await checker.send(sendFor(scope, earlier.watch, drop.alert));
  const movedDelivery = await w.waitAccepted("scoat-watch-alert-" + drop.alert);
  const movedMail = (await w.deliveries()).find(item => item.key === "scoat-watch-alert-" + drop.alert);
  assert.deepEqual(movedMail.message.to, ["person.work@example.test"]);
  lanes[11] = { textUrl, cardOpened: textUrl, consentRequiredBeforeMove: true, activeAfterMove: moved.map(item => ({ watch: item.watch, alertsCurrentRecipient: item.alertsCurrentRecipient })), earlierWatchSend: movedSend, earlierWatchDeliveredTo: movedMail.message.to, accepted: Boolean(movedDelivery) };
  await shot("p08-lane-11", lanes[11]);
  state.pence = 6620;

  const deliveries = await w.deliveries();
  const perKey = Object.values(deliveries.reduce((all, item) => ({ ...all, [item.key]: (all[item.key] ?? 0) + 1 }), {}));
  const summary = { maxAcceptedPerIdentity: Math.max(...perKey), deliveries: deliveries.length, refusals, variant };
  assert.equal(summary.maxAcceptedPerIdentity, 1);
  await writeFile(path.join(evidence, "browser-refusals.json"), JSON.stringify(refusals, null, 1));
  return { lanes: Object.keys(lanes).length, summary, video: lanes[10].video };
 } catch (error) {
  await writeFile(path.join(evidence, "failure.txt"), String(error?.stack ?? error) + "\n" + (await page.content().catch(() => "")).slice(0, 4000));
  process.stderr.write("P08 lane failure: " + String(error?.stack ?? error).slice(0, 3000) + "\n");
  throw error;
 } finally {
  await page.close().catch(() => undefined);
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  await w.close();
 }
}
