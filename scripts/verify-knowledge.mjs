import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Knowledge, validateRelease, renderGuide, auditSources } from "../dist/knowledge/index.js";
import { seed, synthetic, at } from "../test/fixtures/knowledge.mjs";
import { launch, connect } from "./driver.mjs";
import { scratchDirectory } from "./scratch.mjs";
import { guideUri, skillUri } from "../dist/mcp/index.js";
const root = process.env.SCOAT_EVIDENCE_DIR ?? path.join(os.homedir(), `tmp/scoat-delivery/p02/verify-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const identity = { head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), status: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }), node: process.version, client: "raw MCP SDK; no real host claim", baseline: "04fa2db1: guide unavailable in P01 dispatch", command: "npm run verify -- p02" };
const release = await new Knowledge().read({ release: "latest" });
const server = await launch();
let client;
const lanes = [];
async function lane(number, operation) {
  const evidence = await operation();
  const receipt = { ...identity, lane: number, status: "PASS", evidence };
  await fs.writeFile(path.join(root, `lane-${number}.json`), JSON.stringify(receipt, null, 2));
  lanes.push({ lane: number, status: "PASS" });
}
try {
  client = await connect(server.base);
  await lane(1, async () => {
    const result = await client.callTool({ name: "scoat_guide", arguments: { job: "best-benefit", shop: "nike" } });
    assert.equal(result.structuredContent.ok, true);
    assert.equal(result.structuredContent.rows.length, 8);
    assert.deepEqual(result.structuredContent.rows[1].slots, [0, 1, 2, 3]);
    return result;
  });
  await lane(2, async () => {
    const guide = renderGuide({ release, request: { job: "best-benefit", shop: "nike" }, format: "tool" });
    assert.match(guide.method, /Nike/); assert.match(guide.gap, /primary-source/);
    return { guide, audit: auditSources(release, new Date().toISOString()), note: "No published shop claims; Nike is explicitly unsupported" };
  });
  await lane(3, async () => {
    const result = await client.callTool({ name: "scoat_guide", arguments: { job: "best-benefit", shop: null } });
    const prompt = await client.getPrompt({ name: "hunt-best-benefit", arguments: {} });
    const resource = await client.readResource({ uri: guideUri });
    const skill = await client.readResource({ uri: skillUri });
    assert.equal(prompt.messages[0].content.text, result.content[0].text);
    assert.equal(resource.contents[0].text, result.content[0].text);
    assert.equal(skill.contents[0].text, result.content[0].text);
    return { result, prompt, resource, skill };
  });
  await lane(4, async () => {
    const directory = await scratchDirectory("p02-live-");
    try {
      const knowledge = new Knowledge(directory);
      const raw = seed();
      const id = await knowledge.publish(raw, at);
      const before = await fs.readFile(path.join(directory, `${id}.json`), "utf8");
      raw.id = "gb-method-second"; raw.publishedAt = "2026-11-04T01:00:00Z";
      await knowledge.publish(raw, at);
      const first = await new Knowledge(directory).read({ release: id });
      const after = await fs.readFile(path.join(directory, `${id}.json`), "utf8");
      assert.equal(before, after);
      return { first, latest: await knowledge.read({ release: "latest" }), beforeSha256: createHash("sha256").update(before).digest("hex"), afterSha256: createHash("sha256").update(after).digest("hex") };
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  await lane(5, async () => {
    const errors = [];
    for (const slots of [[0, 1, 2], [0, 1, 1, 3]]) {
      const raw = seed(); raw.rows[1].slots = slots;
      assert.throws(() => validateRelease(raw, at), error => { errors.push(error.message); return /other-sellers slots/.test(error.message); });
    }
    return { errors };
  });
  await lane(6, async () => {
    const result = await client.callTool({ name: "scoat_guide", arguments: { job: "best-benefit", shop: "unlisted-shop" } });
    assert.equal(result.structuredContent.rows.length, 8); assert.match(result.structuredContent.gap, /unknown shop/);
    return result;
  });
  await lane(7, async () => {
    const raw = synthetic(); raw.facts[0].validUntil = "2026-11-03T12:00:00Z";
    let message;
    assert.throws(() => validateRelease(raw, at), error => { message = error.message; return /Expired/.test(message); });
    return { fixture: raw, rejection: message };
  });
  await lane(8, async () => {
    const raw = synthetic(); const parsed = validateRelease(raw, at);
    assert.equal(parsed.facts[1].status, "untested"); raw.facts[1].status = "confirmed";
    assert.throws(() => validateRelease(raw, at), /untested/);
    return { syntheticOnly: true, code: parsed.facts[1], attemptedPromotion: "rejected" };
  });
  await lane(9, async () => {
    const result = await client.readResource({ uri: skillUri });
    for (const requirement of [/source URL plus observed time/, /every slot/, /named gap/, /server/, /cashback and points separate/]) assert.match(result.contents[0].text, requirement);
    return result;
  });
  await lane(10, async () => {
    const audit = auditSources(release, new Date().toISOString());
    for (const shop of audit.shops) if (shop.status === "unsupported") assert.ok(shop.reason && shop.refreshOwner);
    for (const claim of audit.claims) assert.ok(claim.source && claim.observedAt && claim.refreshOwner);
    return audit;
  });
} finally { if (client) await client.close(); await server.close(); }
await fs.writeFile(path.join(root, "summary.json"), JSON.stringify({ ...identity, lanes, p01HostLanes: { 6: "UNTESTED", 7: "UNTESTED", 8: "PARTIAL" }, modelLaneGate: "UNTESTED: deterministic driver, no delegated gpt-6-luna sessions", evidenceKind: "JSON service/module transcripts; no UI screenshots" }, null, 2));
process.stdout.write(JSON.stringify({ evidence: root, lanes }) + "\n");
