if (process.argv[2] === "p07") { await import("./verify-card.mjs"); process.exit(process.exitCode ?? 0); }
if (process.argv[2] === "p06") { await import("./perf-memory.mjs"); process.exit(process.exitCode ?? 0); }
if (process.argv[2] === "p05") { await import("./perf-auth.mjs"); process.exit(process.exitCode ?? 0); }
if (process.argv[2] === "p04") { await import("./perf-durable.mjs"); process.exit(process.exitCode ?? 0); }
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { launch, connect } from "./driver.mjs";

if (process.argv[2] === "p03") { await import("./perf-hunt.mjs"); process.exit(process.exitCode ?? 0); }
if (process.argv[2] === "p02") { await import("./perf-knowledge.mjs"); process.exit(process.exitCode ?? 0); }
if (process.argv[2] !== "p01") throw new Error("Supported scope: perf -- p01");
const server = await launch();
let client;
const batches = [];
const loadBefore = os.loadavg();
try {
  client = await connect(server.base);
  const call = () => client.callTool({ name: "scoat_guide", arguments: { job: "best-benefit", shop: null } });
  for (let n = 0; n < 10; n++) await call();
  for (let batch = 0; batch < 5; batch++) {
    const samples = [];
    for (let n = 0; n < 100; n++) {
      const start = performance.now();
      const result = await call();
      if (result.isError || result.structuredContent?.ok !== true || result.structuredContent?.rows.length !== 8 || result.structuredContent?.currency !== "GBP") throw new Error("Unexpected fixture result");
      samples.push(performance.now() - start);
    }
    batches.push({ batch, samplesMs: samples, p95Ms: [...samples].sort((a,b) => a-b)[94] });
  }
} finally { if (client) await client.close(); await server.close(); }
const root = process.env.SCOAT_EVIDENCE_DIR ?? path.join(os.homedir(), "tmp/scoat-delivery/p01", `perf-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const report = { source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), worktreeStatus: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }), trackedPatchSha256: createHash("sha256").update(execFileSync("git", ["diff", "HEAD"], { maxBuffer: 4000000 })).digest("hex"), command: ["npm", "run", "perf", "--", "p01"], node: process.version, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, availableParallelism: os.availableParallelism(), loadBefore, loadAfter: os.loadavg(), platform: `${os.platform()} ${os.release()} ${os.arch()}`, fixture: "p01-v1", measuredCalls: 500, expectedGuideReplies: 500, unexpectedReplies: 0, metric: "Sequential local HTTP round trips returning P02 complete guide results; not shopping work", baseline: "UNAVAILABLE: trunk has no MCP endpoint; no speedup ratio", fixedTwoVcpuBudget: "UNTESTED unless independently provisioned 2-vCPU runner", limiter: "Not profiled; no throughput, optimization or relative performance claim", exclusions: ["installation", "clean build", "startup", "10 warmup calls", "external network"], batches };
await fs.writeFile(path.join(root, "perf.json"), JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify({ evidence: root, p95Ms: batches.map(b => b.p95Ms), baseline: report.baseline, runnerCpus: report.logicalCpus }) + "\n");
if (batches.some(b => b.p95Ms > 500)) process.exitCode = 1;
