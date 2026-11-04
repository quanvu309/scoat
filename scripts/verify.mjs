if (process.argv[2] === "p04") { await import("./verify-durable.mjs"); process.exit(process.exitCode ?? 0); }
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { launch, connect, doctor } from "./driver.mjs";
import { toolCatalog, schemas, appUri } from "../dist/mcp/index.js";
import { confirmationFixture } from "../fixtures/confirmation.mjs";

const args = process.argv.slice(2);
if (args[0] === "doctor") { process.stdout.write(JSON.stringify(await doctor()) + "\n"); process.exit(0); }
if (process.argv[2] === "p03") { await import("./verify-hunt.mjs"); process.exit(process.exitCode ?? 0); }
if (args[0] === "p02") { await import("./verify-knowledge.mjs"); process.exit(0); }
if (args[0] !== "p01") throw new Error("Supported executable scope: verify -- p01 [--lane 1..10]");
const laneArg = args.includes("--lane") ? Number(args[args.indexOf("--lane") + 1]) : null;
if (laneArg !== null && (!Number.isInteger(laneArg) || laneArg < 1 || laneArg > 10)) throw new Error("--lane must be 1..10");
const root = process.env.SCOAT_EVIDENCE_DIR ?? path.join(os.homedir(), "tmp/scoat-delivery/p01", `run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const identity = { source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), worktreeStatus: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }), trackedPatchSha256: createHash("sha256").update(execFileSync("git", ["diff", "HEAD"], { maxBuffer: 4000000 })).digest("hex"), command: ["npm", "run", "verify", "--", ...args], node: process.version, fixture: "p01-v1", client: "@modelcontextprotocol/sdk 1.32.2 raw Client" };
const rows = [];
let server = await launch();
let client;
const transcript = [];
const call = async (name, input) => {
  const result = await client.callTool({ name, arguments: input });
  transcript.push({ name, input, result });
  return result;
};
try {
  client = await connect(server.base);
  for (const lane of laneArg ? [laneArg] : [1,2,3,4,5,6,7,8,9,10]) {
    const start = transcript.length;
    let status = "PASS";
    let note = "";
    if (lane === 1) {
      const health = await (await fetch(`${server.base}/healthz`)).json();
      assert.equal(health.ready, true);
      transcript.push({ health });
      const result = await call("scoat_guide", { job: "best-benefit", shop: null });
      assert.equal(result.structuredContent.ok, true);
      assert.equal(result.structuredContent.rows.length, 8);
      note = "Trunk has no build/start/HTTP endpoint. Head returns P02 guidance; hunt execution remains unavailable.";
    } else if (lane === 2) {
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map(t => t.name).sort(), Object.keys(toolCatalog).sort());
      for (const tool of listed.tools) assert.deepEqual(tool.inputSchema, schemas()[tool.name]);
      transcript.push({ listed });
    } else if (lane === 3) {
      for (const field of ["account", "person", "actor", "total", "unknown"]) {
        const result = await call("scoat_hunt", { op: "list", [field]: "synthetic-forgery" });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent, undefined);
      }
    } else if (lane === 4) {
      const result = await call("scoat_card", { op: "act", hunt: "fixture-hunt", grant: "synthetic-untrusted", requestKey: "fixture-click", action: { kind: "stop" } });
      assert.equal(result.structuredContent.error.code, "forbidden");
    } else if (lane === 5) {
      const resource = await client.readResource({ uri: appUri });
      assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
      assert.match(resource.contents[0].text, /default-src 'none'/);
      assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains, []);
      transcript.push({ resource });
    } else if (lane === 6 || lane === 7) {
      status = "UNTESTED";
      note = lane === 6 ? "No real app-capable host session/version available. Static resource retrieval does not prove bridge rendering." : "No real text-host session/version available. Raw SDK client is not a real-host pass.";
    } else if (lane === 8) {
      const fixture = await confirmationFixture();
      try {
        const get = await fetch(fixture.url, { headers: { cookie: `fixture_session=${fixture.sessionA}` } });
        assert.equal(get.status, 405);
        const noSession = await fetch(fixture.url, { method: "POST", headers: { "x-fixture-nonce": fixture.nonce } });
        const wrongSession = await fetch(fixture.url, { method: "POST", headers: { cookie: `fixture_session=${fixture.sessionB}`, "x-fixture-nonce": fixture.nonce } });
        assert.equal(noSession.status, 403); assert.equal(wrongSession.status, 403);
        assert.equal(fixture.mutations(), 0);
        const confirmed = await fetch(fixture.url, { method: "POST", headers: { cookie: `fixture_session=${fixture.sessionA}`, "x-fixture-nonce": fixture.nonce } });
        assert.equal(confirmed.status, 204); assert.equal(fixture.mutations(), 1);
        transcript.push({ confirmation: { get: get.status, noSession: noSession.status, wrongSession: wrongSession.status, sameSession: confirmed.status, mutations: fixture.mutations() } });
        note = "Isolated fixture session-binding proof only. OAuth, browser login, same-account production confirmation UNTESTED; full lane remains blocked.";
        status = "PARTIAL";
      } finally { await fixture.close(); }
    } else if (lane === 9) {
      await client.close(); await server.close();
      transcript.push({ previousProcessStopped: true, logs: server.logs });
      server = await launch(); client = await connect(server.base);
      assert.equal((await client.listTools()).tools.length, 4);
      transcript.push({ reconnected: true });
    } else if (lane === 10) {
      await call("scoat_hunt", { op: "read", hunt: "synthetic-private-product" });
      assert.deepEqual(server.logs, []);
      const matrix = await fs.readFile("docs/host-support.md", "utf8");
      assert.match(matrix, /UNTESTED/);
      transcript.push({ serverLogs: server.logs, policy: "No request logging; no credentials persisted in transcript" });
    }
    const row = { lane, status, note, ...identity, transcript: transcript.slice(start) };
    await fs.mkdir(path.join(root, `lane-${lane}`), { recursive: true });
    await fs.writeFile(path.join(root, `lane-${lane}`, "transcript.json"), JSON.stringify(row, null, 2));
    rows.push({ lane, status, note });
  }
} finally { if (client) await client.close(); await server.close(); }
await fs.writeFile(path.join(root, "summary.json"), JSON.stringify({ ...identity, rows, fullP01Verification: false }, null, 2));
process.stdout.write(JSON.stringify({ evidence: root, rows, fullP01Verification: false }) + "\n");
