import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { withDatabase } from "./durable-database.mjs";
import { watchLanes } from "./watch-lanes.mjs";

const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "";
const evidence = process.env.SCOAT_EVIDENCE_DIR ?? path.join(os.homedir(), "tmp/scoat-delivery/p08", "verify-" + Date.now());
await mkdir(evidence, { recursive: true });
const started = Date.now();
const result = await withDatabase(url => watchLanes(url, evidence, head + (dirty ? "+worktree" : "")));
const video = path.join(evidence, "p08-review.webm");
await rename(result.video, video);
const receipt = { status: "PASS_LOCAL_ONLY", head, dirty, evidence, seconds: (Date.now() - started) / 1000, lanes: result.lanes, summary: result.summary, video, postgres: "real local PostgreSQL 17 with pg-boss 12.38.0 schema", https: "real local TLS issuer, upstream OIDC fixture, Pi Hut format seller fixture and durable Resend-contract capture process", browser: "Playwright Chromium native forms", externalProvider: "UNTESTED", realHosts: "UNTESTED", modelAgentLanes: "UNTESTED", fixedTwoVcpu: "UNTESTED", liveSellerCheckout: "UNTESTED" };
await writeFile(path.join(evidence, "receipt.json"), JSON.stringify(receipt, null, 1));
console.log(JSON.stringify({ status: receipt.status, evidence, head, lanes: result.lanes, maxAcceptedPerIdentity: result.summary.maxAcceptedPerIdentity }));
