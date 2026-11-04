import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
export async function evidence(kind) {
  const root =
    process.env.SCOAT_EVIDENCE_DIR ??
    path.join(os.homedir(), "tmp/scoat-delivery/p05", kind + "-" + Date.now());
  await fs.mkdir(root, { recursive: true });
  const git = (...args) =>
    execFileSync("git", args, { encoding: "utf8", maxBuffer: 4000000 }).trim();
  const identity = {
    head: git("rev-parse", "HEAD"),
    base: "ad69c8ee546daa57241c4a7096835c160cbfd3f0",
    worktreeStatus: git("status", "--porcelain"),
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpus: os.cpus().length,
    cpu: os.cpus()[0]?.model,
    memory: os.totalmem(),
    load: os.loadavg(),
    fixture:
      "synthetic local upstream issuer; compiled production HTTPS server; PostgreSQL; no real host",
  };
  const baseline = {
    head: git("rev-parse", "origin/main"),
    authenticatedMetric: "UNAVAILABLE",
    reason: "Trunk has no authenticated durable HTTP flow",
    sharedTrunkMetric:
      "UNAVAILABLE; trunk MCP/knowledge interfaces are unimplemented stubs and have no HTTP server",
    ratio: null,
  };
  await fs.writeFile(
    path.join(root, "trunk-mcp.txt"),
    git("show", "origin/main:src/mcp/index.ts"),
  );
  await fs.writeFile(
    path.join(root, "baseline.json"),
    JSON.stringify(baseline, null, 2),
  );
  return {
    root,
    identity,
    baseline,
    async save(file, value) {
      await fs.writeFile(path.join(root, file), JSON.stringify(value, null, 2));
    },
  };
}
