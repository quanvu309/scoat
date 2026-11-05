import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { checkPerfStory } from "../scripts/check-perf.mjs";

const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const original = (revision, file) => execFileSync("git", ["show", revision + ":" + file], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 1 << 24 });
const replaced = (source, from, to) => { assert.ok(source.includes(from), "missing " + from); return source.replace(from, to); };
const current = { entry: read("scripts/perf.mjs"), p09: read("scripts/perf-p09.mjs"), story: read("scripts/perf-story.mjs"), lineage: read("scripts/perf-lineage.mjs") };
const story = (from, to) => ({ ...current, story: replaced(current.story, from, to) });
const p09 = (from, to) => ({ ...current, p09: replaced(current.p09, from, to) });
const anchor = "    conditions.seller.setPence(5620);\n";

test("perf -- p09 runs the public end-to-end story before the supplementary microbenchmark", () => {
 assert.doesNotThrow(() => checkPerfStory(current));
 assert.throws(() => checkPerfStory({ ...current, entry: original("9705fec", "scripts/perf.mjs") }), /end-to-end story metric/);
 assert.throws(() => checkPerfStory({ ...current, lineage: original("9705fec", "scripts/perf-lineage.mjs") }), /supplementary microbenchmark/);
 assert.throws(() => checkPerfStory({ ...current, entry: replaced(current.entry, 'await import("./perf-p09.mjs");', 'await import("./perf-p09.mjs"); await import("./perf-lineage.mjs");') }), /end-to-end story metric/);
 assert.throws(() => checkPerfStory(p09("story = await measureStory();", "story = null;")), /measure and judge/);
 assert.throws(() => checkPerfStory(p09('const trunk = trunkProbe();', 'await import("./perf-lineage.mjs");\nconst trunk = trunkProbe();')), /only after the story metric/);
 assert.throws(() => checkPerfStory(p09("failure || !verdict?.pass", "failure")), /story verdict/);
});

test("the perf story reaches state only through public clients and keeps the 5 s budgets", () => {
 assert.throws(() => checkPerfStory({ ...current, story: read("scripts/perf-watch.mjs") }), /imports only public clients|bypasses/);
 assert.throws(() => checkPerfStory(story(anchor, "    await fixture.seedWatch({ targetPence: 6800 });\n" + anchor)), /bypasses/);
 assert.throws(() => checkPerfStory(story(anchor, "    await fixture.watches().check(job);\n" + anchor)), /fixture\.watches bypasses/);
 assert.throws(() => checkPerfStory(story(anchor, "    await fixture.pool.query(\"SELECT 1\");\n" + anchor)), /fixture\.pool bypasses/);
 assert.throws(() => checkPerfStory(story(anchor, "    await conditions.read(\"UPDATE watches SET target_pence=6800 RETURNING id\");\n" + anchor)), /direct database writes/);
 assert.throws(() => checkPerfStory(story(anchor, "    await conditions.read(sql);\n" + anchor)), /literal SELECT/);
 assert.throws(() => checkPerfStory(story('import { confirm } from "./memory-lanes.mjs";', 'import { confirm } from "./memory-lanes.mjs";\nimport { Watches } from "../dist/memory/watches.js";')), /imports only public clients/);
 assert.throws(() => checkPerfStory(story('import { watchFixture, productUrl } from "./watch-fixture.mjs";', 'import { watchFixture, productUrl, sellerPages } from "./watch-fixture.mjs";')), /may import only/);
 assert.throws(() => checkPerfStory(story("huntMilliseconds: 5000", "huntMilliseconds: 50000")), /huntMilliseconds/);
 assert.throws(() => checkPerfStory(story("eligibleToOutboxMilliseconds: 5000", "eligibleToOutboxMilliseconds: limit")), /eligibleToOutboxMilliseconds/);
 assert.throws(() => checkPerfStory(story("acceptancesPerAlert: 1", "acceptancesPerAlert: 2")), /acceptancesPerAlert/);
 assert.throws(() => checkPerfStory(story('fetch(issuer + "/healthz")', 'fetch(issuer + "/")')), /SDK MCP client/);
});
