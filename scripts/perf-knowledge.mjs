import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { validateRelease, renderGuide } from "../dist/knowledge/index.js";
import { seed, at } from "../test/fixtures/knowledge.mjs";
const raw = seed();
raw.id = "synthetic-perf";
raw.shops = Array.from({ length: 100 }, (_, index) => ({ id: `synthetic-${index}`, label: `Synthetic ${index}`, status: "unsupported", reason: "Synthetic performance fixture; not retailer knowledge", refreshOwner: "Synthetic fixture owner" }));
const release = validateRelease(raw, at);
const loadBefore = os.loadavg();
const expected = Array.from({ length: 100 }, (_, index) => renderGuide({ release, request: { job: "best-benefit", shop: `synthetic-${index}` }, format: "tool" }).method);
const validate = () => { const result = validateRelease(raw, at); assert.deepEqual(result, release); assert.equal(result.shops.length, 100); assert.equal(result.rows.length, 8); };
const guide = index => {
  const result = renderGuide({ release, request: { job: "best-benefit", shop: `synthetic-${index % 100}` }, format: "tool" });
  assert.equal(result.method, expected[index % 100]); assert.equal(result.release, raw.id); assert.equal(result.rows.length, 8); assert.equal(result.rows[1].slots.length, 4); assert.match(result.method, /Synthetic performance fixture/);
};
for (let index = 0; index < 100; index++) { validate(); guide(index); }
const batches = [];
for (let batch = 0; batch < 5; batch++) {
  const validationMs = [], guideMs = [];
  for (let index = 0; index < 100; index++) {
    let start = performance.now(); validate(); validationMs.push(performance.now() - start);
    start = performance.now(); guide(index); guideMs.push(performance.now() - start);
  }
  batches.push({ batch, validationMs, guideMs, validationP95Ms: [...validationMs].sort((a,b) => a-b)[94], guideP95Ms: [...guideMs].sort((a,b) => a-b)[94] });
}
const root = process.env.SCOAT_EVIDENCE_DIR ?? path.join(os.homedir(), `tmp/scoat-delivery/p02/perf-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const report = { head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), status: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }), command: "npm run perf -- p02", baseline: "UNAVAILABLE: 04fa2db1 P01 guide and knowledge validation unimplemented; no unlike-operation ratio", fixture: { shops: 100, rowsPerShop: 8, sellerSlots: 4, synthetic: true }, node: process.version, cpu: os.cpus()[0]?.model, cpus: os.cpus().length, availableParallelism: os.availableParallelism(), loadBefore, loadAfter: os.loadavg(), platform: `${os.platform()} ${os.release()} ${os.arch()}`, fixedTwoVcpuGate: "UNTESTED on this runner", limiter: "CPU parsing/freezing and string rendering; not profiled, no speedup claim", exclusions: ["install", "build", "startup", "100 warmup operations each", "network", "file I/O"], batches };
await fs.writeFile(path.join(root, "perf.json"), JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify({ evidence: root, batches: batches.map(({ batch, validationP95Ms, guideP95Ms }) => ({ batch, validationP95Ms, guideP95Ms })) }) + "\n");
if (batches.some(batch => batch.validationP95Ms > 100 || batch.guideP95Ms > 100)) process.exitCode = 1;
