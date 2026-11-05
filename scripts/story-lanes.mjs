import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { productUrl } from "./watch-fixture.mjs";
import { serveCard } from "./card-fixture.mjs";

const maskStatus = () => {
 const mask = () => { for (const code of document.querySelectorAll("code")) if (code.textContent !== "[masked status secret]") code.textContent = "[masked status secret]"; };
 new MutationObserver(mask).observe(document, { childList: true, subtree: true, characterData: true });
};
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

export async function openCardLink(page, button) {
 const before = await page.evaluate(() => window.harness.opened.length);
 await button.click();
 await page.waitForFunction(count => window.harness.opened.length > count, before);
 return page.evaluate(count => window.harness.opened[count], before);
}

export async function linkedStory({ fixture, conditions, page, evidence, log, secrets, visible, dwell }) {
 const issuer = fixture.f.issuer;
 const steps = [];
 const step = async (name, run) => {
  const started = Date.now();
  log({ kind: "step", step: name, event: "start" });
  const result = await run();
  steps.push({ step: name, status: "PASS", seconds: (Date.now() - started) / 1000, result });
  log({ kind: "step", step: name, event: "pass", result });
  return result;
 };
 const capture = async name => {
  const texts = [];
  for (const frame of page.frames()) texts.push(await frame.evaluate(() => document.body?.innerText ?? "").catch(() => ""));
  visible({ screenshot: "p09-review-" + name + ".png", url: page.url(), text: texts.join("\n---frame---\n") });
  await page.screenshot({ path: path.join(evidence, "p09-review-" + name + ".png"), fullPage: true });
  await dwell();
 };
 const host = async name => {
  const login = await fixture.f.login(name);
  secrets.add(name + " bearer", login.token);
  const client = new Client({ name: "scoat-p09-" + name, version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", issuer), { requestInit: { headers: { authorization: "Bearer " + login.token } } }));
  log({ kind: "public-oauth", host: name, event: "authorization-code with PKCE completed; SDK StreamableHTTP client connected" });
  const call = async (tool, args) => {
   const wire = await client.callTool({ name: tool, arguments: args });
   const parsed = JSON.parse(wire.content.at(-1).text);
   assert.deepEqual(parsed, wire.structuredContent);
   const result = { ...wire, structuredContent: parsed };
   log({ kind: "public-mcp", host: name, tool, args, isError: result.isError === true, structured: result.structuredContent ?? null, text: result.content?.[0]?.text ?? null });
   return result;
  };
  const ok = async (tool, args) => { const result = await call(tool, args); assert.ok(!result.isError, JSON.stringify(result).slice(0, 2000)); return result; };
  return { name, login, client, call, ok, hunt: args => ok("scoat_hunt", args), memory: async args => (await ok("scoat_memory", args)).structuredContent.value };
 };
 const approve = async (url, button) => {
  await page.goto(url);
  await page.getByRole("button", { name: button }).waitFor();
  const response = page.waitForResponse(item => item.request().method() === "POST" && item.url().startsWith(issuer + "/account/"));
  await page.getByRole("button", { name: button }).click();
  const answered = await response;
  await page.waitForLoadState();
  return { status: answered.status(), body: (await page.locator("body").innerText()).slice(0, 600) };
 };
 const grants = [];
 const observe = (params, result) => { const grant = result?._meta?.["scoat/readCapability"]?.grant; if (grant) { grants.push({ hunt: params.arguments.hunt, grant }); secrets.add("card read grant", grant); } };
 const control = async (url, button) => {
  const result = await approve(url, button);
  assert.equal(result.status, 200, result.body);
  return JSON.parse(result.body).value.status;
 };

 const startup = await step("0-release-identity", async () => {
  const health = await (await fetch(issuer + "/healthz")).json();
  const worker = await conditions.worker.start();
  assert.equal(health.ready, true, JSON.stringify(health));
  assert.equal(health.artifact.status, "verified");
  assert.match(worker.artifact, /^sha256:[0-9a-f]{64}$/);
  assert.equal(health.artifact.digest, worker.artifact);
  return { healthDigest: health.artifact.digest, workerDigest: worker.artifact, reasons: health.reasons };
 });

 const one = await host("host-one");
 const huntA = await step("1-pi-hut-hunt", async () => {
  const started = await one.hunt({ op: "start", requestKey: randomUUID(), profile: null, intent: { product: { kind: "url", url: productUrl }, variant: "4GB", shop: null, budget: null } });
  assert.ok(started.structuredContent.ok);
  let view = started.structuredContent.value.view;
  const slots = view.rows.reduce((total, row) => total + row.slots.length, 0);
  assert.equal(view.rows.length, 8);
  assert.equal(slots, 11);
  let first = true;
  for (const row of view.rows) for (const slot of row.slots) {
   const current = view.rows.find(value => value.row.id === row.row.id);
   const proof = { url: productUrl, observedAt: new Date().toISOString(), note: "SYNTHETIC local Pi Hut fixture observation" };
   const base = { seller: "The Pi Hut", variant: "4GB", status: { kind: "confirmed" }, proof, validUntil: null };
   const outcome = first ? { kind: "found", offers: [{ ...base, kind: "price", amount: { currency: "GBP", pence: 6620 } }, { ...base, kind: "delivery", amount: { currency: "GBP", pence: 380 } }, { ...base, kind: "discount", status: { kind: "needs-step", steps: ["verify-student"] }, adjustment: { kind: "fixed", amount: { currency: "GBP", pence: 700 } }, code: null, codeOrigin: null, minimumSpend: { currency: "GBP", pence: 0 }, order: 0 }] } : { kind: "gap", reason: "SYNTHETIC unavailable" };
   const recorded = await one.call("scoat_hunt", { op: "record", requestKey: randomUUID(), hunt: view.hunt, row: row.row.id, slot: slot.slot, expected: current.revision, outcome });
   if (first && !recorded.structuredContent?.ok) { first = false; continue; }
   assert.ok(recorded.structuredContent.ok, JSON.stringify(recorded).slice(0, 2000));
   view = recorded.structuredContent.value.view; first = false;
  }
  const ids = kind => view.offers.filter(item => item.kind === kind).map(item => item.id);
  const proof = [{ url: productUrl, observedAt: new Date().toISOString(), note: "SYNTHETIC local Pi Hut fixture compatibility" }];
  for (const offers of [[...ids("price"), ...ids("delivery")], [...ids("price"), ...ids("delivery"), ...ids("discount")]]) {
   const linked = await one.hunt({ op: "compatibility", requestKey: randomUUID(), hunt: view.hunt, evidence: { offers, proof } });
   assert.ok(linked.structuredContent.ok);
   view = linked.structuredContent.value.view;
  }
  const finished = await one.hunt({ op: "finish", requestKey: randomUUID(), hunt: view.hunt, selection: null });
  assert.ok(finished.structuredContent.ok);
  const read = await one.hunt({ op: "read", hunt: view.hunt });
  const canonical = read.structuredContent.value.view;
  const quote = canonical.final.quote;
  assert.equal(canonical.final.kind, "finished");
  assert.equal(quote.guaranteed.kind, "known");
  assert.equal(quote.guaranteed.amount.pence, 7000);
  assert.equal(quote.conditional.length, 1);
  assert.equal(quote.conditional[0].payToday.amount.pence, 6300);
  assert.deepEqual(quote.conditional[0].requires, ["verify-student"]);
  assert.equal(canonical.progress.resolved, canonical.progress.total);
  assert.ok(canonical.ready?.url);
  const text = read.content[0].text;
  assert.ok(text.startsWith(canonical.text));
  for (const amount of ["GBP 70.00", "GBP 63.00"]) assert.ok(canonical.text.includes(amount), amount);
  const watchUrl = /Watch price: (\S+)/.exec(text)?.[1];
  assert.equal(watchUrl, read.structuredContent.controls.watch.url);
  return { hunt: canonical.hunt, release: canonical.release, progress: canonical.progress, ready: canonical.ready, known: quote.guaranteed.amount, conditional: quote.conditional[0].payToday.amount, requires: quote.conditional[0].requires, rows: canonical.rows.length, slots, watchUrl, account: new URL(watchUrl).searchParams.get("account"), view: canonical, initial: read.structuredContent };
 });
 const account = huntA.account;
 const incarnation = (await conditions.read("SELECT incarnation::text AS incarnation FROM hunt_accounts WHERE account=$1 AND erased_at IS NULL", [account]))[0].incarnation;

 const memory = await step("2-memory-approval", async () => {
  const profile = { op: "profile", requestKey: randomUUID(), profile: { student: "yes", cards: ["SYNTHETIC card"], memberships: [] } };
  const profileProposal = await one.memory(profile);
  assert.equal(profileProposal.kind, "confirmation-required");
  const profileApproval = await approve(profileProposal.url, "Approve exact command");
  assert.equal(profileApproval.status, 200, profileApproval.body);
  const applied = await one.memory(profile);
  assert.equal(applied.kind, "profile");
  const save = { op: "save", requestKey: randomUUID(), hunt: huntA.hunt };
  const saveProposal = await one.memory(save);
  assert.equal(saveProposal.kind, "confirmation-required");
  await page.goto(saveProposal.url);
  await page.getByRole("button", { name: "Approve exact command" }).waitFor();
  await capture("memory");
  const response = page.waitForResponse(item => item.request().method() === "POST" && item.url() === issuer + "/account/memory");
  await page.getByRole("button", { name: "Approve exact command" }).click();
  assert.equal((await response).status(), 200);
  const saved = await one.memory(save);
  assert.equal(saved.kind, "saved");
  assert.deepEqual(await one.memory(save), saved);
  return { profile: profile.profile, profileApprovalStatus: profileApproval.status, saved: saved.item };
 });

 const two = await host("host-two");
 await step("3-host-two-resume", async () => {
  const listed = (await two.hunt({ op: "list" })).structuredContent;
  assert.ok(JSON.stringify(listed).includes(huntA.hunt));
  const resumed = (await two.hunt({ op: "read", hunt: huntA.hunt })).structuredContent.value.view;
  assert.equal(resumed.release, huntA.release);
  assert.deepEqual(resumed.progress, huntA.progress);
  assert.deepEqual(resumed.ready, huntA.ready);
  assert.deepEqual(resumed.final, huntA.view.final);
  const overview = await two.memory({ op: "read" });
  assert.deepEqual(overview.profile.value, memory.profile);
  const item = await two.memory({ op: "item", item: memory.saved });
  assert.ok(JSON.stringify(item).includes(huntA.hunt));
  const watchUrl = /Watch price: (\S+)/.exec((await two.hunt({ op: "read", hunt: huntA.hunt })).content[0].text)?.[1];
  assert.equal(new URL(watchUrl).searchParams.get("account"), account);
  return { sameAccount: true, release: resumed.release, progress: resumed.progress, savedItem: memory.saved };
 });

 const controls = await step("4-skip-stop", async () => {
  const started = await one.hunt({ op: "start", requestKey: randomUUID(), profile: null, intent: { product: { kind: "url", url: productUrl }, variant: "4GB", shop: null, budget: null } });
  const hunt = started.structuredContent.value.view.hunt;
  const read = await one.hunt({ op: "read", hunt });
  const hub = /Browser controls: (\S+)/.exec(read.content[0].text)?.[1];
  assert.equal(hub, read.structuredContent.controls.hub);
  const rows = read.structuredContent.value.view.rows;
  const textSkip = await control(hub, "Skip row " + rows[1].row.id);
  assert.equal(textSkip, "applied");
  const card = await serveCard(fixture.f, one.login, read.structuredContent, observe);
  try {
   await page.goto(card.url);
   const frame = page.frameLocator("iframe");
   await frame.getByText("Current hunt", { exact: true }).waitFor();
   await frame.getByText("Skipped by you", { exact: true }).waitFor();
   const skipLink = await openCardLink(page, frame.getByRole("button", { name: "Skip " + rows[2].row.label, exact: true }));
   const cardSkip = await control(skipLink, "Skip row " + rows[2].row.id);
   assert.equal(cardSkip, "applied");
   await page.goto(card.url);
   await frame.getByText("Current hunt", { exact: true }).waitFor();
   await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.innerText.split("Skipped by you").length === 3);
   const stopLink = await openCardLink(page, frame.getByRole("button", { name: "Stop new discovery", exact: true }));
   const cardStop = await control(stopLink, "Stop accepting new discoveries");
   assert.equal(cardStop, "applied");
   const stamp = async () => (await conditions.read("SELECT data->>'stopRequestedAt' AS stamp FROM durable_hunts WHERE account=$1 AND id=$2", [account, hunt]))[0].stamp;
   const first = await stamp();
   assert.ok(first);
   await page.goto(hub);
   await page.getByRole("button", { name: "Stop accepting new discoveries" }).waitFor();
   await capture("control");
   const repeated = await control(hub, "Stop accepting new discoveries");
   assert.equal(repeated, "unchanged");
   assert.equal(await stamp(), first);
   await page.goto(card.url);
   await frame.getByText("Discovery stopped", { exact: true }).waitFor();
   const after = (await one.hunt({ op: "read", hunt })).structuredContent.value.view;
   assert.equal(after.stopRequested, true);
   assert.deepEqual(after.rows.filter(row => row.skippedBy === "person").map(row => row.row.id), [rows[1].row.id, rows[2].row.id]);
   let view = after;
   for (const row of view.rows) if (row.skippedBy !== "person") for (const slot of row.slots) if (slot.completion.kind === "pending") {
    const current = view.rows.find(value => value.row.id === row.row.id);
    const recorded = await one.hunt({ op: "record", requestKey: randomUUID(), hunt, row: row.row.id, slot: slot.slot, expected: current.revision, outcome: { kind: "gap", reason: "SYNTHETIC unavailable after Stop" } });
    assert.ok(recorded.structuredContent.ok);
    view = recorded.structuredContent.value.view;
   }
   assert.ok((await one.hunt({ op: "finish", requestKey: randomUUID(), hunt, selection: null })).structuredContent.ok);
   return { hunt, textSkip, cardSkip, cardStop, repeatedStop: repeated, stopTimestampPreserved: true, skipped: [rows[1].row.id, rows[2].row.id] };
  } finally { await card.close(); }
 });

 const email = "p09-story-" + randomBytes(6).toString("hex") + "@example.test";
 secrets.add("recipient email", email);
 const watch = await step("5-watch-and-mail", async () => {
  const card = await serveCard(fixture.f, one.login, huntA.initial, observe);
  let watched;
  try {
   await page.goto(card.url);
   const frame = page.frameLocator("iframe");
   await frame.getByText("Finished", { exact: true }).waitFor();
   await frame.getByText("Finished result. It no longer changes, so the card does not poll.").waitFor();
   assert.equal(await frame.getByText("Connecting…").count(), 0);
   const finalQuote = await frame.getByRole("region", { name: "Finished quote", exact: true }).innerText();
   assert.ok(finalQuote.includes("The Pi Hut"));
   assert.ok(finalQuote.includes("£70.00"));
   const cardText = await frame.locator("body").innerText();
   assert.ok(cardText.includes("£63.00"));
   assert.ok(cardText.includes("Requires verify-student"));
   assert.ok(await frame.locator(`a[href="${productUrl}"]`).count() >= 1);
   assert.equal(await frame.getByRole("link", { name: "Open clean shop link" }).getAttribute("href"), huntA.ready.url);
   await frame.getByRole("region", { name: "Finished quote", exact: true }).scrollIntoViewIfNeeded();
   await capture("card");
   conditions.identity.setEmail({ email, email_verified: true });
   watched = await openCardLink(page, frame.getByRole("button", { name: "Watch price", exact: true }));
   assert.equal(watched, huntA.watchUrl);
  } finally { await card.close(); }
  await page.goto(watched);
  await page.getByText("Confirm price watch").waitFor();
  const confirmText = await page.locator("body").innerText();
  assert.match(confirmText, /Public delivered baseline\s*GBP 70\.00/);
  assert.ok(!confirmText.includes(email));
  await page.getByLabel("Your target delivered price (GBP)").fill("68.00");
  await page.getByRole("button", { name: "Start watching" }).click();
  await page.getByText("Watch active").waitFor();
  await capture("watch");
  const item = (await one.memory({ op: "read", collection: "watches" })).items.find(value => value.hunt === huntA.hunt);
  assert.equal(item.status, "active");
  assert.equal(item.baseline.pence, 7000);
  conditions.seller.setPence(5620);
  const accepted = conditions.mail.next();
  await conditions.schedule.tick();
  const delivery = await accepted;
  await conditions.settle({ plans: 1 });
  const deliveries = await conditions.mail.deliveries();
  assert.equal(deliveries.length, 1);
  const mail = deliveries[0].message;
  assert.deepEqual(mail.to, [email]);
  assert.ok(mail.text.includes("GBP 60.00"));
  const requestsAfterFirst = (await conditions.mail.requests()).length;
  await conditions.schedule.tick();
  await conditions.settle({ plans: 2 });
  assert.equal((await conditions.mail.deliveries()).length, 1);
  assert.equal((await conditions.mail.requests()).length, requestsAfterFirst);
  const link = mail.headers["List-Unsubscribe"].slice(1, -1);
  const token = new URL(link).searchParams.get("token");
  secrets.add("unsubscribe token", token);
  secrets.add("unsubscribe link", link);
  const masked = mail.html.replaceAll(link, issuer + "/watch/unsubscribe?token=[masked]").replaceAll(link.replaceAll("&", "&amp;"), issuer + "/watch/unsubscribe?token=[masked]").replaceAll(token, "[masked]").replaceAll(email, "[masked recipient]");
  await page.setContent(`<title>Captured local TLS mail</title><body style="font:14px system-ui;margin:20px"><p><strong>Captured by the local TLS Resend-contract fixture.</strong> To: [masked recipient]. Subject: ${mail.subject.replaceAll("<", "&lt;")}</p><hr>${masked}</body>`);
  await capture("mail");
  return { watch: item.watch, baselinePence: item.baseline.pence, targetPence: 6800, acceptedKey: delivery.accepted, deliveries: 1, deliveredText: "GBP 60.00", secondTickNewDeliveries: 0, requestsAfterFirst, link, listUnsubscribePost: mail.headers["List-Unsubscribe-Post"] };
 });

 await step("6-one-click-unsubscribe", async () => {
  assert.equal(watch.listUnsubscribePost, "List-Unsubscribe=One-Click");
  const response = await fetch(watch.link, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  const html = await response.text();
  assert.equal(response.status, 200);
  await page.setContent(`<body style="font:14px system-ui;margin:20px"><p><strong>RFC 8058 one-click POST response for the captured link.</strong></p><hr>${html}</body>`);
  await capture("unsubscribe");
  const item = (await one.memory({ op: "read", collection: "watches" })).items.find(value => value.watch === watch.watch);
  assert.equal(item.status, "cancelled");
  const before = { requests: (await conditions.mail.requests()).length, seller: conditions.seller.hits() };
  const next = { account, incarnation, watch: watch.watch, day: day(1) };
  await conditions.schedule.nextDayCheck(next);
  await conditions.settle({ plans: 2, job: next });
  const after = { requests: (await conditions.mail.requests()).length, seller: conditions.seller.hits() };
  assert.deepEqual(after, before);
  return { status: response.status, watchStatus: item.status, nextDayCheck: "completed", newMailRequests: 0, newSellerRequests: 0 };
 });

 await step("7-paused-worker-erasure", async () => {
  conditions.seller.setPence(6620);
  const fresh = await one.hunt({ op: "read", hunt: controls.hunt });
  const textWatch = /Watch price: (\S+)/.exec(fresh.content[0].text)?.[1];
  assert.equal(textWatch, fresh.structuredContent.controls.watch.url);
  await page.goto(textWatch);
  await page.getByLabel("Your target delivered price (GBP)").fill("68.00");
  await page.getByRole("button", { name: "Start watching" }).click();
  await page.getByText("Watch active").waitFor();
  const second = (await one.memory({ op: "read", collection: "watches" })).items.find(value => value.hunt === controls.hunt);
  assert.equal(second.status, "active");
  conditions.seller.setPence(5620);
  conditions.worker.pause();
  await conditions.schedule.tick();
  await conditions.schedule.nextDayCheck({ account, incarnation, watch: second.watch, day: day(1) });
  const before = { requests: (await conditions.mail.requests()).length, deliveries: (await conditions.mail.deliveries()).length, seller: conditions.seller.hits() };
  const queuedBefore = (await conditions.read(`SELECT count(*)::integer AS n FROM ${fixture.queueSchema}.job WHERE data->>'account'=$1`, [account]))[0].n;
  page.on("response", async response => { if (response.request().resourceType() === "document" && response.url().startsWith(issuer)) { const status = /<code>([^<]+)<\/code>/.exec(await response.text().catch(() => ""))?.[1]; if (status) secrets.add("erase status secret", status); } });
  await page.goto(issuer + "/account/erase");
  await page.getByRole("button", { name: "Erase this account" }).waitFor();
  const erased = page.waitForResponse(item => item.request().method() === "POST" && item.url() === issuer + "/account/erase");
  await page.getByRole("button", { name: "Erase this account" }).click();
  const receipt = await erased;
  assert.equal(receipt.status(), 200);
  await page.waitForLoadState();
  await capture("erase");
  conditions.worker.resume();
  await conditions.schedule.tick();
  await conditions.settle({ plans: 3 });
  const after = { requests: (await conditions.mail.requests()).length, deliveries: (await conditions.mail.deliveries()).length, seller: conditions.seller.hits() };
  assert.deepEqual(after, before);
  const queuedAfter = (await conditions.read(`SELECT count(*)::integer AS n FROM ${fixture.queueSchema}.job WHERE data->>'account'=$1`, [account]))[0].n;
  assert.equal(queuedAfter, 0);
  const needles = { account, incarnation, subject: "upstream-subject-A", email };
  const inventory = {};
  for (const [schema, owner] of [[(await conditions.read("SELECT current_schema() AS s"))[0].s, "application"], [fixture.queueSchema, "queue"]]) {
   const tables = await conditions.read("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name", [schema]);
   for (const { table_name: table } of tables) for (const [label, needle] of Object.entries(needles)) {
    const n = (await conditions.read(`SELECT count(*)::integer AS n FROM "${schema}"."${table}" AS r WHERE r::text LIKE '%' || $1 || '%'`, [needle]))[0].n;
    if (n) inventory[owner + "." + table + ":" + label] = n;
   }
  }
  const tombstone = (await conditions.read("SELECT erased_at IS NOT NULL AS erased FROM hunt_accounts WHERE account=$1", [account]))[0];
  assert.deepEqual(inventory, { "application.account_suppression:account": 1, "application.account_suppression:incarnation": 1, "application.hunt_accounts:account": 1, "application.hunt_accounts:incarnation": 1 });
  assert.equal(tombstone.erased, true);
  const rpc = async (token, method, params) => (await fetch(issuer + "/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25", authorization: "Bearer " + token }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).status;
  const refusals = { hostOne: await rpc(one.login.token, "tools/list", {}), hostTwo: await rpc(two.login.token, "tools/list", {}), cardGrants: [] };
  assert.ok(grants.length >= 2);
  for (const item of grants) refusals.cardGrants.push(await rpc(one.login.token, "tools/call", { name: "scoat_card", arguments: { op: "read", hunt: item.hunt, grant: item.grant } }));
  assert.equal(refusals.hostOne, 401);
  assert.equal(refusals.hostTwo, 401);
  assert.ok(refusals.cardGrants.every(status => status === 401));
  return { secondWatch: second.watch, secondWatchEntry: "text link", queuedBeforeErase: queuedBefore, queuedAfter, newOutbound: { mail: after.requests - before.requests, seller: after.seller - before.seller }, inventory, tombstone: tombstone.erased, refusals };
 });
 await Promise.allSettled([one.client.close(), two.client.close()]);
 return { steps, startup, projection: { hunt: huntA.hunt, release: huntA.release, rows: huntA.rows, slots: huntA.slots, known: huntA.known, conditional: huntA.conditional, requires: huntA.requires, ready: huntA.ready, progress: huntA.progress, text: huntA.view.text, view: huntA.view }, ids: { account, hunt: huntA.hunt, controlsHunt: controls.hunt, saved: memory.saved, watch: watch.watch } };
}

export { maskStatus };
