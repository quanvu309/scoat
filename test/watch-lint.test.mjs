import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkWatchSender, checkWatchErasure, checkPublicFetch, checkWatchVerification, checkWatchResponses, checkWatchLockOrder, checkWatchRecipient, checkWatchEntry, checkWatchBoundary, checkWatchWorker, checkWatchActivation, checkWatchQueueIsolation } from "../scripts/check-structure.mjs";

const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const watches = read("src/memory/watches.ts"), queue = read("src/queue/index.ts"), erasure = read("src/accounts/erasure.ts"), fetch = read("src/delivery/fetch.ts");

test("watch sender keeps a fenced durable marker, rechecks the fence and resubmits immutable work", () => {
 assert.doesNotThrow(() => checkWatchSender(watches));
 const marker = "await client.query(\"UPDATE watch_alerts SET state='submitting',marked_at=coalesce(marked_at,clock_timestamp()),attempts=attempts+1 WHERE account=$1 AND incarnation=$2 AND watch=$3 AND id=$4\", ids);";
 assert.ok(watches.includes(marker));
 assert.throws(() => checkWatchSender(watches.replace(marker, "")), /durable submission marker/);
 assert.throws(() => checkWatchSender(watches.replace(" const marked = await retryTransaction(this.deps.pool, async client => {\n   if (!await activeAccount(client, scope, \"SHARE\")) return \"refused\" as const;", " const marked = await retryTransaction(this.deps.pool, async client => {")), /durable submission marker/);
 assert.throws(() => checkWatchSender(watches.replace("const active = await activeAccount(client, scope, \"SHARE\");", "const active = true;")), /active account incarnation/);
 assert.throws(() => checkWatchSender(watches.replaceAll("recipient.revision !== alert.recipient_revision", "false")), /recipient revision/);
 assert.throws(() => checkWatchSender(watches.replace("z.string().parse(alert.provider_key)", "randomUUID()")), /immutable stored payload/);
 assert.throws(() => checkWatchSender(watches.replace("messageSchema.parse(alert.message)", "messageSchema.parse(message)")), /immutable stored payload/);
 assert.throws(() => checkWatchSender(watches.replace("AbortSignal.timeout(watchLimits.submitMilliseconds)", "new AbortController().signal")), /submit deadline/);
 assert.throws(() => checkWatchSender(watches.replace("client.on(\"error\", lost);", "")), /connection loss/);
 const fence = "if (watch?.status !== \"active\" || watch.live !== true || alert.open !== true || !recipient || recipient.revision !== alert.recipient_revision) {";
 assert.ok(watches.includes(fence));
 assert.throws(() => checkWatchSender(watches.replace(fence, "if (watch.live !== true || alert.open !== true || !recipient || recipient.revision !== alert.recipient_revision) {")), /watch status/);
 assert.throws(() => checkWatchSender(watches.replace(fence, "if (watch?.status !== \"active\" || alert.open !== true || !recipient || recipient.revision !== alert.recipient_revision) {")), /watch expiry/);
 assert.throws(() => checkWatchSender(watches.replace(fence, "if (watch?.status !== \"active\" || watch.live !== true || !recipient || recipient.revision !== alert.recipient_revision) {")), /retry deadline/);
 assert.throws(() => checkWatchSender(watches.replace("  if (!this.deps.delivery.canSubmit) throw new Error(\"Mail transport unavailable; no submission marker was written\");\n", "")), /absent mail transport/);
 assert.throws(() => checkWatchSender(watches.replace("  } finally {\n   client.off(\"error\", lost);\n   client.release(broken);\n  }", "  }\n  client.release(broken);")), /every return path/);
});

test("watch cancellation and erasure delete every scoped queue state and report unresolved markers", () => {
 assert.doesNotThrow(() => checkWatchErasure(watches, queue, erasure));
 assert.throws(() => checkWatchErasure(watches.replace("counts.queue_jobs = await deleteScopedJobs(client, scope);", "counts.queue_jobs = 0;"), queue, erasure), /every watch cancellation and erasure/);
 assert.throws(() => checkWatchErasure(watches.replace("const jobs = await deleteScopedJobs(client, { ...scope, watch });", "const jobs = 0;"), queue, erasure), /every watch cancellation and erasure/);
 const original = queue.replace("DELETE FROM ${queueSchema}.job WHERE data @> $1::jsonb`, [filter]", "DELETE FROM ${queueSchema}.job WHERE name = ANY($1::text[]) AND data @> $2::jsonb`, [[queueNames.check, queueNames.send], filter]");
 assert.notEqual(original, queue);
 assert.throws(() => checkWatchErasure(watches, original, erasure), /every queue name and state/);
 assert.throws(() => checkWatchErasure(watches, queue.replace("if (survivors.rows[0]?.count !== 0) throw new Error(\"Queue erasure survivor\");", ""), erasure), /zero survivors/);
 assert.throws(() => checkWatchErasure(watches, queue.replace("retryLimit: 3,", "retryLimit: 3, deadLetter: \"watch-dead\","), erasure), /dead-letter/);
 assert.throws(() => checkWatchErasure(watches, queue, erasure.replace("watchMail: { mayStillArrive: watches.mayStillArrive", "watchMail: { mayStillArrive: 0")), /unresolved watch submission/);
});

test("public fetch pins validated addresses, checks every redirect hop and never blocks all mapped IPv4", () => {
 assert.doesNotThrow(() => checkPublicFetch(fetch));
 assert.throws(() => checkPublicFetch(fetch.replace('["2002::", 16],', '["2002::", 16], ["::ffff:0:0", 96],').replace("privateV6.addSubnet(address, prefix, \"ipv6\");", "privateV6.addSubnet(address, prefix, \"ipv6\"); privateV6.addSubnet(\"::ffff:0:0\", 96, \"ipv6\");")), /IPv4-mapped/);
 assert.throws(() => checkPublicFetch(fetch.replace("|| !hosts.has(current.hostname)", "")), /every redirect hop/);
 assert.throws(() => checkPublicFetch(fetch.replace("lookup: pin,", "")), /pinned address/);
 assert.throws(() => checkPublicFetch(fetch.replace("rejectUnauthorized: true,", "rejectUnauthorized: false,")), /TLS hostnames/);
});

test("watch responses reject undeclared provider fields and disable activation caching", () => {
 const delivery = read("src/delivery/index.ts"), issuer = read("src/auth/issuer.ts");
 assert.doesNotThrow(() => checkWatchResponses(delivery, issuer));
 assert.throws(() => checkWatchResponses(delivery.replace("const accepted = z.strictObject", "const accepted = z.object"), issuer), /strict object schema/);
 const shared = "const watchHeaders = { \"content-type\": \"text/html; charset=utf-8\", \"content-security-policy\": \"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'\", \"referrer-policy\": \"same-origin\", \"cache-control\": \"no-store\" } as const;";
 assert.ok(issuer.includes(shared));
 assert.throws(() => checkWatchResponses(delivery, issuer.replace(shared, shared.replace(', "cache-control": "no-store"', ""))), /activation response/);
 const start = issuer.indexOf('if (url.pathname === "/account/watch")');
 const end = issuer.indexOf('if (url.pathname === "/watch/unsubscribe")', start);
 assert.ok(start >= 0 && end > start);
 const inline = issuer.slice(start, end).replace("pageHead(res, 200, watchHeaders);", "pageHead(res, 200, { \"content-type\": \"text/html; charset=utf-8\" });");
 assert.notEqual(inline, issuer.slice(start, end));
 assert.throws(() => checkWatchResponses(delivery, issuer.slice(0, start) + inline + issuer.slice(end)), /activation response/);
});

test("P08 verification routes through the existing skill, feature index and runnable branch", () => {
 const skill = read(".agents/skills/verify-scoat/SKILL.md"), index = read(".agents/skills/verify-scoat/features/README.md"), runner = read("scripts/verify.mjs");
 assert.doesNotThrow(() => checkWatchVerification(skill, index, runner));
 assert.throws(() => checkWatchVerification(skill.replace(/P08/g, "P0x"), index, runner), /features\/watches.md/);
 assert.throws(() => checkWatchVerification(skill, index.replace("[price watches](watches.md)", ""), runner), /features\/watches.md/);
 assert.throws(() => checkWatchVerification(skill, index, runner.replace('process.argv[2] === "p08"', 'process.argv[2] === "p8"')), /runnable p08/);
});

const originalPlan = ` async plan(): Promise<{ checks: number; sends: number; expired: number }> {
  const enqueue = this.deps.enqueue;
  if (!enqueue) throw new Error("Queue unavailable");
  return retryTransaction(this.deps.pool, async client => {
   const day = z.string().parse((await client.query("SELECT ((now() AT TIME ZONE 'UTC')::date)::text AS day")).rows[0]?.day);
   const ended = await client.query("UPDATE watches w SET status='expired',ended_at=clock_timestamp() FROM hunt_accounts a WHERE a.account=w.account AND a.incarnation=w.incarnation AND NOT a.erased AND w.status='active' AND w.expires_at<=now()");
   await client.query("UPDATE watch_alerts SET state=CASE WHEN state='pending' THEN 'cancelled' ELSE 'unconfirmed' END,outcome_at=clock_timestamp(),last_error='retry-horizon' WHERE state IN ('pending','submitting') AND deadline<=clock_timestamp()");
   const due = (await client.query("SELECT w.account,w.incarnation,w.id FROM watches w JOIN hunt_accounts a USING(account,incarnation) WHERE NOT a.erased AND w.status='active' ORDER BY w.account,w.incarnation,w.id LIMIT 5000 FOR SHARE OF a", [day])).rows;
   return { checks: due.length, sends: 0, expired: ended.rowCount ?? 0 };
  });
 }

`;

test("plan and erasure lock account fences before watch, alert and queue rows", () => {
 assert.doesNotThrow(() => checkWatchLockOrder(watches));
 const start = watches.indexOf(" async plan("), end = watches.indexOf(" async check(");
 assert.ok(start > 0 && end > start);
 assert.throws(() => checkWatchLockOrder(watches.slice(0, start) + originalPlan + watches.slice(end)), /sorted account fences/);
 assert.throws(() => checkWatchLockOrder(watches.replace(" await client.query(\"SELECT id FROM watches WHERE account=$1 AND incarnation=$2 ORDER BY id FOR UPDATE\", prefix);\n const counts", " const counts")), /Erasure must lock watch rows/);
});

test("planning advances beyond the first page without dropping work inside a fence", () => {
 assert.doesNotThrow(() => checkWatchLockOrder(watches));
 assert.throws(() => checkWatchLockOrder(watches.replace("AND ($1::text IS NULL OR (a.account,a.incarnation)>($1::text,$2::uuid))", "")), /advance account keyset/);
 assert.throws(() => checkWatchLockOrder(watches.replace("cursor = page.last;", "")), /advance account keyset/);
 assert.throws(() => checkWatchLockOrder(watches.replace("ORDER BY w.account,w.incarnation,w.id`", "ORDER BY w.account,w.incarnation,w.id LIMIT 5000`")), /advance account keyset/);
 assert.throws(() => checkWatchLockOrder(watches.replace("ORDER BY account,incarnation,id`", "ORDER BY account,incarnation,id LIMIT 5000`")), /advance account keyset/);
});

test("a recipient change re-points every active watch only with explicit consent", () => {
 assert.doesNotThrow(() => checkWatchRecipient(watches));
 const repoint = "UPDATE watches SET recipient_revision=$3 WHERE account=$1 AND incarnation=$2 AND status='active'";
 assert.ok(watches.includes(repoint));
 assert.throws(() => checkWatchRecipient(watches.replace(repoint, "UPDATE watches SET recipient_revision=$4 WHERE account=$1 AND incarnation=$2 AND id=$3")), /every active watch/);
 assert.throws(() => checkWatchRecipient(watches.replace("if (moving && prepared.otherActive > 0 && !input.moveRecipient) throw new WatchRefusal(\"recipient-changed\");", "")), /explicit consent/);
});

test("text and live card expose one canonical watch entry", () => {
 const codec = read("src/controls/codec.ts"), contract = read("src/mcp/outputs.ts"), dispatch = read("src/mcp/authenticated.ts"), renderer = read("src/card/renderer.tsx");
 assert.doesNotThrow(() => checkWatchEntry(codec, contract, dispatch, renderer));
 assert.throws(() => checkWatchEntry(codec.replace("url:link({kind:\"skip\",row:row.row.id})}))};", "url:link({kind:\"skip\",row:row.row.id})})),watch:{available:false,reason:\"Watch through scoat_memory op watch; Scoat returns a browser confirmation link for a supported exact public item\"}};"), contract, dispatch, renderer), /fixed codec reason/);
 assert.throws(() => checkWatchEntry(codec, contract.replace("available: z.literal(true)", "available: z.literal(false)"), dispatch, renderer), /canonical watch link/);
 assert.throws(() => checkWatchEntry(codec, contract, dispatch.replace("watch: watchEntry(", "watch: ({ available: false as const, reason: \"Watch through scoat_memory\" }) && watchEntry("), renderer), /one canonical watch entry/);
 assert.throws(() => checkWatchEntry(codec, contract, dispatch, renderer.replace("void open(controls.watch.url)", "void open(controls.hub)")), /open the canonical watch link/);
});

test("watch preparation, refusals, issuer origin and one-click parsing stay in their owners", () => {
 const issuer = read("src/auth/issuer.ts"), memory = read("src/memory/index.ts");
 assert.doesNotThrow(() => checkWatchBoundary(issuer, watches, memory));
 const inline = "        const prepared = await watches.prepare(target, hunt);";
 assert.ok(issuer.includes(inline));
 assert.throws(() => checkWatchBoundary(issuer.replace(inline, inline + "\n        const command = (await pool.query(\"SELECT command FROM memory_commands WHERE account=$1 AND incarnation=$2 AND key=$3\", [target.account,target.incarnation,hunt])).rows[0];\n        const parsed = z.object({ op: z.literal(\"watch\"), hunt: z.string() }).parse(command?.command);"), watches, memory), /Memory watch aggregate/);
 assert.throws(() => checkWatchBoundary(issuer, watches.replace("watchCommandSchema.parse(proposal.command)", "z.object({ op: z.literal(\"watch\"), hunt: z.string(), target: z.strictObject({ currency: z.literal(\"GBP\"), pence: z.number().int() }) }).parse(proposal.command)"), memory), /strict command schema/);
 assert.throws(() => checkWatchBoundary(issuer.replace("        if (!(error instanceof WatchRefusal)) throw error;\n", ""), watches, memory), /typed watch refusals/);
 assert.throws(() => checkWatchBoundary(issuer.replace("  if (watches && watches.issuer !== issuer) throw new Error(\"Watch unsubscribe origin must equal the authorization issuer origin\");\n", ""), watches, memory), /one authoritative issuer origin/);
 assert.throws(() => checkWatchBoundary(issuer.replace("      await oneClick(req);", "      if (req.headers[\"content-type\"]?.split(\";\")[0] !== \"application/x-www-form-urlencoded\") throw new Error(\"Unsubscribe requires a form POST\");\n      const submitted = await form(req);\n      if ([...submitted.keys()].length !== 1 || submitted.get(\"List-Unsubscribe\") !== \"One-Click\") throw new Error(\"Invalid unsubscribe body\");"), watches, memory), /RFC 8058 one-click/);
 assert.throws(() => checkWatchBoundary(issuer.replace("    if (size > 4096) throw new Error(\"Unsubscribe body too large\");\n", ""), watches, memory), /RFC 8058 one-click/);
});

test("the worker refuses absent mail before queue work and never reports false ambiguity", () => {
 const worker = read("src/worker.ts"), delivery = read("src/delivery/index.ts");
 assert.doesNotThrow(() => checkWatchWorker(worker, delivery));
 assert.throws(() => checkWatchWorker(worker.replace(" if (!options.delivery.canSubmit) throw new Error(\"Watch worker requires a mail transport; refusing before queue work or submission markers\");\n", ""), delivery), /before queue work/);
 assert.throws(() => checkWatchWorker(worker.replace(" if (config.resendApiKey === null) throw new Error(\"Watch worker requires resendApiKey; refusing before queue work or submission markers\");\n", ""), delivery), /without a mail key/);
 assert.throws(() => checkWatchWorker(worker, delivery.replace("if (!mail) throw new Error(\"Mail transport unavailable\");", "if (!mail) return { kind: \"ambiguous\", reason: \"mail-unconfigured\" };")), /ambiguous provider acceptance/);
});

test("watch activation requires configured mail and catches invalid browser targets", () => {
 const issuer = read("src/auth/issuer.ts"), server = read("src/server.ts"), views = read("src/browser/views.ts");
 const check = (w = watches, i = issuer, s = server, v = views) => checkWatchActivation(w, i, s, v);
 assert.doesNotThrow(() => check());
 assert.throws(() => check(watches.replace("return this.deps.config.resendApiKey !== null;", "return true;")), /configured worker mail key/);
 for (const guard of ['  if (!this.available) return { kind: "unavailable", reason: "service-unconfigured" };', '  if (!this.available) throw new WatchRefusal("service-unconfigured");']) {
  assert.ok(watches.includes(guard));
  assert.throws(() => check(watches.replace(guard, "")), /before state access/);
 }
 assert.throws(() => check(watches, issuer.replace("if (!watches?.available)", "if (!watches)")), /through watch availability/);
 assert.throws(() => check(watches, issuer, server.replace("watches?.available === true", "watches !== undefined")), /through watch availability/);
 assert.throws(() => check(watches, issuer, server, views.replace("watches?.available && issued.finished", "watches && issued.finished")), /through watch availability/);
 for (const name of ["amount", "pence"]) assert.throws(() => check(watches, issuer.replace('if (!' + name + '.success) throw new WatchRefusal("invalid-target");', "")), /invalid-target/);
 const outside = issuer.replace("      try {\n        const pence = targetPence(fields.target);", "      const pence = targetPence(fields.target);\n      try {");
 assert.notEqual(outside, issuer);
 assert.throws(() => check(watches, outside), /inside the typed watch-refusal boundary/);
 assert.throws(() => check(watches, issuer, server, views.replace('form method="post" action="/account/watch"', 'form method="get" action="/account/watch"')), /correction form/);
 assert.throws(() => check(watches, issuer, server, views.replace('escapeHtml(correction.confirmation)', '"missing"')), /correction form/);
 assert.throws(() => check(watches, issuer.replace('moveRecipient: fields.recipient === "move"', 'moveRecipient: false')), /correction form/);
});

test("queue setup, erasure and fixture teardown share an isolated application namespace", () => {
 const fixture = read("scripts/watch-fixture.mjs");
 const drivers = [read("scripts/watch-lanes.mjs"), read("scripts/perf-watch.mjs")];
 assert.doesNotThrow(() => checkWatchQueueIsolation(queue, fixture, drivers));
 assert.throws(() => checkWatchQueueIsolation(queue, fixture, drivers.map(driver => driver.replaceAll("${w.queueSchema}.job", "pgboss.job"))), /fixture namespace/);
 assert.throws(() => checkWatchQueueIsolation(queue.replace('SELECT current_schema() AS schema', 'SELECT \'public\' AS schema'), fixture), /queue namespace/);
 assert.throws(() => checkWatchQueueIsolation(queue.replaceAll('await queueSchemaFor(client)', '\"pgboss\"'), fixture), /same queue namespace/);
 assert.throws(() => checkWatchQueueIsolation(queue, fixture.replace('DROP SCHEMA IF EXISTS ${queueSchema} CASCADE', 'DROP SCHEMA IF EXISTS pgboss CASCADE')), /only their own/);
});
