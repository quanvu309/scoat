import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { scratchDirectory } from "./scratch.mjs";
import { measureStory, judgeStory, storyBudget } from "./perf-story.mjs";

const checkout = new URL("..", import.meta.url).pathname;
const git = args => execFileSync("git", args, { cwd: checkout, encoding: "utf8", maxBuffer: 1 << 26 });
const attempt = args => { try { return git(args).trim(); } catch { return null; } };
const evidence = process.env.SCOAT_EVIDENCE_DIR ?? await scratchDirectory("perf-", path.join(os.homedir(), "tmp/scoat-delivery/p09"));
process.env.SCOAT_EVIDENCE_DIR = evidence;
const identity = { head: git(["rev-parse", "HEAD"]).trim(), porcelain: git(["status", "--porcelain"]), trackedPatchSha256: createHash("sha256").update(git(["diff", "HEAD"])).digest("hex") };

function trunkProbe() {
 const ref = ["origin/main", "main"].find(name => attempt(["rev-parse", "--verify", "--quiet", name + "^{commit}"]));
 if (!ref) return { status: "unavailable", reason: "no trunk ref (origin/main or main) on this runner", sharedOperations: [] };
 const revision = attempt(["rev-parse", ref]);
 const scripts = Object.keys(JSON.parse(attempt(["show", revision + ":package.json"]) ?? "{}").scripts ?? {});
 const present = file => attempt(["cat-file", "-e", revision + ":" + file]) !== null;
 const surfaces = { perfScript: scripts.includes("perf"), buildScript: scripts.includes("build"), server: present("src/server.ts"), worker: present("src/worker.ts"), migrations: present("db/migrations"), readiness: present("src/readiness.ts") };
 const runnable = Object.values(surfaces).every(Boolean);
 return { status: runnable ? "present-unmeasured" : "unavailable", ref, revision, probedBeforeHead: true, scripts, surfaces, reason: runnable ? "trunk defines the story surfaces; a same-runner trunk measurement must be added before any ratio" : "trunk has no HTTP/MCP server, database, worker, readiness or perf entry, so neither the scripted hunt nor any shared operation (health, worker announce, watch queue) can run there", sharedOperations: [], ratio: "none: no like-for-like trunk operation" };
}

const trunk = trunkProbe();
const runner = { cpu: os.cpus()[0]?.model ?? "unknown", logicalCpus: os.cpus().length, availableParallelism: os.availableParallelism(), memoryBytes: os.totalmem(), freeBytesBefore: os.freemem(), loadBefore: os.loadavg(), node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}` };
const started = Date.now();
let story = null, verdict = null, failure = null;
try {
 story = await measureStory();
 verdict = judgeStory(story);
} catch (error) { failure = String(error?.stack ?? error).slice(0, 4000); }
await writeFile(path.join(evidence, "story-samples.json"), JSON.stringify({ ...identity, story, failure }, null, 1) + "\n");
await import("./perf-lineage.mjs");
const lineage = JSON.parse(await readFile(path.join(evidence, "perf.json"), "utf8"));
const status = failure || !verdict?.pass ? "FAIL" : "PASS_LOCAL_ONLY";
const receipt = {
 status, scope: "P09 performance: complete scripted eight-row public HTTPS SDK MCP hunt to persisted final HuntView, browser-form watch confirmation, real pg-boss worker notification into the durable outbox and local TLS mail acceptance, with readiness and worker digest", ...identity,
 command: ["npm", "run", "perf", "--", "p09"], evidence, seconds: (Date.now() - started) / 1000,
 runner: { ...runner, loadAfter: os.loadavg(), freeBytesAfter: os.freemem() },
 database: story ? { source: process.env.DATABASE_URL ? "DATABASE_URL service (credentials withheld)" : "embedded local PostgreSQL cluster (initdb trust, single node)", role: story.role, settings: story.settings } : null,
 rule: { huntMilliseconds: "<= " + storyBudget.huntMilliseconds + " per warm hunt (agent-supplied synthetic outcomes; no external search)", eligibleToOutboxMilliseconds: "<= " + storyBudget.eligibleToOutboxMilliseconds + " per warm watch", acceptancesPerAlert: "<= " + storyBudget.acceptancesPerAlert + " and a repeat tick adds no delivery or provider request", readiness: "/healthz ready with the verified digest equal to the worker announcement and dist/release.json", warmBatches: ">= 5" },
 method: {
  hunt: "One SDK 1.32.2 StreamableHTTP client over local HTTPS with a bearer from the fixture authorization-code + PKCE login calls scoat_hunt start, eleven slot records, two compatibility links, finish and read. huntMs spans start through read. A READ ONLY query then asserts durable_hunts.snapshot holds the finished HuntView (GBP 70.00 known, GBP 63.00 conditional) and eight hunt_rows.",
  watch: "The last hunt of each batch is watched through the issuer /account/watch form with the scripted fixture cookie jar (not native Chromium). The seller fixture price drops to 5620 + 380 delivery, one real daily plan tick runs in the fixture worker process, and the local TLS mail capture accepts the message.",
  eligibleToOutbox: "Database clock: watch-check job completed_on minus watch_observations.observed_at (clock_timestamp at the observation insert after the seller fetch). The check job completes only after the outbox transaction (alert row + watch-send job) commits, so this bounds the outbox write from the observation insert. The statements before that insert (BEGIN, lineage fence, account and watch locks) are covered by the second gate: the whole watch-check job, started_on to completed_on including the local seller fetch, must also stay within the same budget.",
  repeat: "After all batches one more plan tick runs for the same day; deliveries and provider requests must not change, every alert provider key is accepted exactly once, and watch_alerts has one accepted row per watch.",
  readiness: "/healthz sampled once at start, ten times per batch and once at the end; worker digest from the compiled startWorker announcement in the fixture worker; worker process liveness per batch.",
 },
 fixtureCounts: story?.fixtureCounts ?? null,
 exclusions: ["installation, npm ci and build", "PostgreSQL cluster initdb/start", "auth and watch fixture setup: isolated schemas, OAuth test provider, issuer keys, TLS certificates, seller and mail capture processes", "OAuth login and MCP client connect", "worker startup", "warmup batch 0", "watch activation form (user confirmation and the seller baseline observation; reported as activationMs, not gated)", "seller fixture fetch inside the check job (stands in for external search; inside checkJobMs, outside eligibleToOutboxMs)", "local mail capture acceptance (reported as tickToAcceptedMs; not real mail arrival)", "browser dwell, screenshots and video (none run)"],
 notMeasured: ["real public search and seller latency", "real mail arrival or production provider acceptance", "production deployment, real hosts, external IdP, managed PostgreSQL", "fixed two-CPU runner (UNTESTED)", "concurrent users (one sequential MCP client; worker localConcurrency 4)"],
 trunk,
 verdict, failure,
 supplementary: { lineageMicrobenchmark: { file: path.join(evidence, "perf.json"), role: "supplementary same-head fenced/unfenced transaction overhead and release verification; not the P09 story metric", overheadP50MsPerBatch: lineage.overheadP50MsPerBatch, releaseVerificationP50Ms: lineage.releaseVerification.p50Ms } },
 fixedTwoCpuBudget: "UNTESTED: no independently provisioned fixed two-CPU runner",
 caveats: ["Single local runner; samples reflect this machine's load at run time", "The database role flags are observed, not chosen: the embedded cluster connects as its initdb superuser", "Production delivery is not claimed"],
};
await writeFile(path.join(evidence, "p09-perf.json"), JSON.stringify(receipt, null, 1) + "\n");
process.stdout.write(JSON.stringify({ status, evidence: path.join(evidence, "p09-perf.json"), head: identity.head, clean: identity.porcelain === "", huntMaxMs: verdict?.huntMs.maxMs ?? null, eligibleToOutboxMaxMs: verdict?.eligibleToOutboxMs.maxMs ?? null, checks: verdict?.checks ?? null, trunk: trunk.status, failure: failure ? failure.slice(0, 600) : null }) + "\n");
if (status !== "PASS_LOCAL_ONLY") process.exitCode = 1;
