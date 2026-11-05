import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { checkAcceptanceAuthority, checkFixtureWorker, checkAcceptanceVerification } from "../scripts/check-acceptance.mjs";

const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const original = (revision, file) => execFileSync("git", ["show", revision + ":" + file], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 1 << 24 });
const replaced = (source, from, to) => { assert.ok(source.includes(from), "missing " + from); return source.replace(from, to); };
const story = read("scripts/story-lanes.mjs"), conditions = read("scripts/story-conditions.mjs");
const swap = (from, to) => ({ story: replaced(story, from, to), conditions });
const anchor = "  conditions.seller.setPence(5620);\n  const accepted";

test("the linked story reaches user state only through public clients and logged conditions", () => {
 assert.doesNotThrow(() => checkAcceptanceAuthority({ story, conditions }));
 assert.throws(() => checkAcceptanceAuthority({ story: read("scripts/watch-lanes.mjs"), conditions }), /imports only public clients/);
 assert.throws(() => checkAcceptanceAuthority({ story: read("scripts/watch-lanes.mjs").replace(/^import .*$/gm, "").replace(/await import\([^)]*\)/g, "({})"), conditions }), /bypasses them/);
 assert.throws(() => checkAcceptanceAuthority(swap(anchor, "  const seeded = await fixture.seedWatch({ targetPence: 6800 });\n" + anchor)), /seedWatch bypasses/);
 assert.throws(() => checkAcceptanceAuthority(swap(anchor, "  await fixture.pool.query(\"UPDATE watches SET target_pence=6800\");\n" + anchor)), /bypasses them|direct database writes/);
 assert.throws(() => checkAcceptanceAuthority(swap(anchor, "  await conditions.read(\"UPDATE watches SET status='cancelled' RETURNING id\");\n" + anchor)), /direct database writes/);
 assert.throws(() => checkAcceptanceAuthority(swap(anchor, "  await conditions.read(`DELETE FROM watches WHERE id=$1 RETURNING id`, [watch]);\n" + anchor)), /direct database writes/);
 assert.throws(() => checkAcceptanceAuthority(swap(anchor, "  fixture.f.setEmail({ email, email_verified: true });\n" + anchor)), /setEmail bypasses/);
 assert.throws(() => checkAcceptanceAuthority(swap(anchor, "  await fixture.f.tool(one.login.token, \"scoat_memory\", { op: \"read\" });\n" + anchor)), /tool bypasses/);
 assert.throws(() => checkAcceptanceAuthority(swap(anchor, "  await fixture.watches().check(job);\n" + anchor)), /watches bypasses/);
 assert.throws(() => checkAcceptanceAuthority(swap('import { productUrl } from "./watch-fixture.mjs";', 'import { productUrl } from "./watch-fixture.mjs";\nimport { ControlCodec } from "../dist/controls/codec.js";')), /imports only public clients/);
 assert.throws(() => checkAcceptanceAuthority(swap('import { productUrl } from "./watch-fixture.mjs";', 'import { productUrl, sellerPages } from "./watch-fixture.mjs";')), /may import only productUrl/);
 assert.throws(() => checkAcceptanceAuthority(swap(anchor, "  const { signUnsubscribe } = await import(\"../dist/memory/watches.js\");\n" + anchor)), /dynamic imports/);
 assert.throws(() => checkAcceptanceAuthority(swap(anchor, "  await conditions.read(sql);\n" + anchor)), /literal SELECT/);
});

test("synthetic conditions are recorded boundaries and proofs stay read-only", () => {
 assert.throws(() => checkAcceptanceAuthority({ story, conditions: replaced(conditions, "    record({ condition: \"seller.setPence\"", "    void ({ condition: \"seller.setPence\"") }), /setPence must be recorded/);
 assert.throws(() => checkAcceptanceAuthority({ story, conditions: replaced(conditions, "\"BEGIN READ ONLY\"", "\"BEGIN\"") }), /READ ONLY/);
 assert.throws(() => checkAcceptanceAuthority({ story, conditions: replaced(conditions, "   async tick() {\n", "   async tick() {\n    await w.pool.query(\"INSERT INTO watches(id) VALUES(1)\");\n") }), /no direct database writes/);
});

test("the fixture worker announces the verified release digest after startup; the original fixture worker fails", () => {
 const worker = read("scripts/watch-worker.mjs");
 assert.doesNotThrow(() => checkFixtureWorker(worker));
 assert.throws(() => checkFixtureWorker(original("25c8465", "scripts/watch-worker.mjs")), /announces its digest/);
 assert.throws(() => checkFixtureWorker(replaced(worker, "process.send?.({ ready: true, artifact: verified.release.digest });", "process.send?.({ ready: true });")), /announces its digest/);
 const early = replaced(replaced(worker, "process.send?.({ ready: true, artifact: verified.release.digest });\n", ""), "const worker = await startWorker", "process.send?.({ ready: true, artifact: verified.release.digest });\nconst worker = await startWorker");
 assert.throws(() => checkFixtureWorker(early), /announces its digest/);
});

test("P09 S4 acceptance is routed through the skill, index, runner and hosted CI", () => {
 const skill = read(".agents/skills/verify-scoat/SKILL.md"), index = read(".agents/skills/verify-scoat/features/README.md"), runner = read("scripts/verify.mjs"), workflow = read(".github/workflows/ci.yaml");
 assert.doesNotThrow(() => checkAcceptanceVerification(skill, index, runner, workflow));
 assert.throws(() => checkAcceptanceVerification(skill.replaceAll("P09 S4", "P09 S3"), index, runner, workflow), /Route P09 S4/);
 assert.throws(() => checkAcceptanceVerification(skill.replaceAll("features/acceptance.md", "features/operations.md"), index, runner, workflow), /Route P09 S4/);
 assert.throws(() => checkAcceptanceVerification(skill, index.replaceAll("[acceptance](acceptance.md)", "acceptance"), runner, workflow), /Route P09 S4/);
 assert.throws(() => checkAcceptanceVerification(skill, index, replaced(runner, 'if (process.argv[2] === "p09") { await import("./verify-story.mjs"); process.exit(process.exitCode ?? 0); }\n', ""), workflow), /Route P09 S4/);
 assert.throws(() => checkAcceptanceVerification(skill, index, runner, original("25c8465", ".github/workflows/ci.yaml")), /Route P09 S4/);
});
