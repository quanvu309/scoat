import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Knowledge, validateRelease, checklist, renderGuide, auditSources, isOfficialSource } from "../src/knowledge/index.ts";
import { seed, synthetic, at } from "./fixtures/knowledge.mjs";

test("publication rejects missing rows, seller slots, aliases, references and provenance", () => {
  for (const [mutate, error] of [
    [(r) => r.rows.pop(), /Missing row/],
    [(r) => r.rows.push(r.rows[0]), /Duplicate checklist/],
    [(r) => r.rows[1].slots.pop(), /other-sellers slots/],
    [(r) => r.rows[1].slots[3] = 0, /other-sellers slots/],
    [(r) => r.shops.push(r.shops[0]), /Duplicate seller/],
    [(r) => r.shops.push({ ...r.shops[0], id: "alias" }), /Duplicate seller configuration/],
    [(r) => r.rows[0].facts.push("missing"), /Dangling/],
    [(r) => r.facts[0].references.push("missing"), /Dangling/],
    [(r) => r.facts[0].validUntil = "2026-11-03T12:00:00Z", /Expired/],
    [(r) => r.facts[0].observedAt = "2027-01-01T00:00:00Z", /provenance/],
    [(r) => r.facts[0].refreshOwner = "", /string/],
    [(r) => r.facts[0].source = "http://example.invalid", /HTTPS/]
  ]) {
    const raw = synthetic(); mutate(raw); assert.throws(() => validateRelease(raw, at), error);
  }
});
test("student declaration never verifies; third-party code never becomes confirmed", () => {
  const raw = synthetic();
  const release = validateRelease(raw, at);
  assert.equal(release.facts[0].status, "needs-step");
  assert.equal(release.facts[1].status, "untested");
  raw.facts[0].status = "confirmed";
  assert.throws(() => validateRelease(raw, at), /declaration/);
  raw.facts[0].status = "needs-step";
  raw.facts[1].status = "confirmed";
  assert.throws(() => validateRelease(raw, at), /untested/);
});
test("all rows survive unknown eligibility and unknown shop; formats have one source", () => {
  const release = validateRelease(seed(), at);
  assert.equal(checklist({ release, profile: { student: "unknown", cards: [], memberships: [] } }).length, 8);
  const guides = ["tool", "prompt", "resource", "skill"].map(format => renderGuide({ release, request: { job: "best-benefit", shop: "unknown" }, format }));
  for (const guide of guides) { assert.deepEqual(guide, guides[0]); assert.match(guide.gap, /unavailable/); assert.equal(guide.rows[1].slots.length, 4); }
});
test("immutable files survive restart, mutation and a second publication", async () => {
  const directory = await mkdtemp(path.join(os.homedir(), "tmp/p02-test-"));
  try {
    const knowledge = new Knowledge(directory);
    const raw = synthetic();
    const first = await knowledge.publish(raw, at);
    const before = await readFile(path.join(directory, `${first}.json`), "utf8");
    const pinned = await knowledge.read({ release: first });
    const rendered = renderGuide({ release: pinned, request: { job: "best-benefit", shop: "synthetic" }, format: "tool" });
    raw.rows[0].method = "mutated";
    assert.throws(() => pinned.rows.push(pinned.rows[0]), TypeError);
    assert.throws(() => pinned.rows[0].slots.push(10), TypeError);
    await assert.rejects(knowledge.publish(raw, at), /Immutable release ID/);
    raw.id = "synthetic-second";
    raw.publishedAt = "2026-11-04T01:00:00Z";
    await knowledge.publish(raw, at);
    const restarted = new Knowledge(directory);
    assert.equal((await restarted.read({ release: "latest" })).id, raw.id);
    assert.equal(await readFile(path.join(directory, `${first}.json`), "utf8"), before);
    const old = await restarted.read({ release: first });
    assert.deepEqual(renderGuide({ release: old, request: { job: "best-benefit", shop: "synthetic" }, format: "tool" }), rendered);
    assert.equal(auditSources(old, "2027-01-01T00:00:00Z").claims[0].freshness, "expired");
    await assert.rejects(restarted.publish(old, "2027-01-01T00:00:00Z"), /Expired/);
    await assert.rejects(restarted.read({ release: "../escape" }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("concurrent publication converges and conflicting content never overwrites", async () => {
  const directory = await mkdtemp(path.join(os.homedir(), "tmp/p02-race-"));
  try {
    const knowledge = new Knowledge(directory);
    const raw = seed();
    assert.deepEqual(await Promise.all([knowledge.publish(raw, at), knowledge.publish(raw, at)]), [raw.id, raw.id]);
    const competing = structuredClone(raw); competing.rows[0].method = "different";
    const results = await Promise.allSettled([knowledge.publish(raw, at), knowledge.publish(competing, at)]);
    assert.deepEqual(results.map(result => result.status), ["fulfilled", "rejected"]);
    assert.equal((await knowledge.read({ release: raw.id })).rows[0].method, raw.rows[0].method);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("official-domain assertions require primary proof and current validity", () => {
  const raw = synthetic();
  raw.facts[1] = { ...raw.facts[1], id: "synthetic-domain", kind: "official-domain", authority: "primary", status: "confirmed", domain: "seller.example.invalid", source: "https://seller.example.invalid/about" };
  raw.shops[0].facts[1] = "synthetic-domain";
  raw.rows.find(row => row.place === "codes").facts = ["synthetic-domain"];
  const release = validateRelease(raw, at);
  assert.equal(isOfficialSource({ release, seller: "synthetic", source: raw.facts[1].source, now: at }), true);
  assert.equal(isOfficialSource({ release, seller: "synthetic", source: raw.facts[1].source, now: "2027-01-01T00:00:00Z" }), false);
  raw.facts[1].domain = "other.example.invalid";
  assert.throws(() => validateRelease(raw, at), /matching primary/);
});
