import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkWatchSender, checkWatchErasure, checkPublicFetch, checkWatchVerification } from "../scripts/check-structure.mjs";

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
 assert.throws(() => checkWatchSender(watches.replace("  } finally {\n   client.off(\"error\", lost);\n   client.release(broken);\n  }", "  }\n  client.release(broken);")), /every return path/);
});

test("watch cancellation and erasure delete every scoped queue state and report unresolved markers", () => {
 assert.doesNotThrow(() => checkWatchErasure(watches, queue, erasure));
 assert.throws(() => checkWatchErasure(watches.replace("counts.queue_jobs = await deleteScopedJobs(client, scope);", "counts.queue_jobs = 0;"), queue, erasure), /every watch cancellation and erasure/);
 assert.throws(() => checkWatchErasure(watches.replace("const jobs = await deleteScopedJobs(client, { ...scope, watch });", "const jobs = 0;"), queue, erasure), /every watch cancellation and erasure/);
 assert.throws(() => checkWatchErasure(watches, queue.replace("[[queueNames.check, queueNames.send], filter]", "[[queueNames.send, queueNames.daily], filter]"), erasure), /every account-scoped queue/);
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

test("P08 verification routes through the existing skill, feature index and runnable branch", () => {
 const skill = read(".agents/skills/verify-scoat/SKILL.md"), index = read(".agents/skills/verify-scoat/features/README.md"), runner = read("scripts/verify.mjs");
 assert.doesNotThrow(() => checkWatchVerification(skill, index, runner));
 assert.throws(() => checkWatchVerification(skill.replace(/P08/g, "P0x"), index, runner), /features\/watches.md/);
 assert.throws(() => checkWatchVerification(skill, index.replace("[price watches](watches.md)", ""), runner), /features\/watches.md/);
 assert.throws(() => checkWatchVerification(skill, index, runner.replace('process.argv[2] === "p08"', 'process.argv[2] === "p8"')), /runnable p08/);
});
