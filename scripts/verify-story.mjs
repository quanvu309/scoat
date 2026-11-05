import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { withDatabase } from "./durable-database.mjs";
import { scratchDirectory } from "./scratch.mjs";
import { postgresClientTools } from "./lane-tools.mjs";
import { watchFixture } from "./watch-fixture.mjs";
import { storyConditions } from "./story-conditions.mjs";
import { linkedStory, maskStatus } from "./story-lanes.mjs";

const exec = promisify(execFile);
const git = args => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 26 });
const sha = data => createHash("sha256").update(data).digest("hex");
const head = git(["rev-parse", "HEAD"]).trim();
const porcelain = git(["status", "--porcelain"]);
const identity = { head, clean: porcelain.trim() === "", porcelain: porcelain.split("\n").filter(Boolean), trackedPatchSha256: sha(execFileSync("git", ["diff", "HEAD"], { maxBuffer: 1 << 26 })) };
const evidence = process.env.SCOAT_EVIDENCE_DIR ?? await scratchDirectory("story-", path.join(os.homedir(), "tmp/scoat-delivery/p09/s4"));
const pgTools = postgresClientTools();
const tool = async (variable, name) => {
 const file = process.env[variable] ?? name;
 try { return { file, version: (await exec(file, ["-version"], { timeout: 15000 })).stdout.split("\n")[0] }; }
 catch { return { file, missing: variable + " or " + name + " on PATH" }; }
};
const ffmpeg = await tool("SCOAT_FFMPEG", "ffmpeg"), ffprobe = await tool("SCOAT_FFPROBE", "ffprobe");
const dwellMilliseconds = Number(process.env.SCOAT_STORY_DWELL_MS ?? 3200);
const secrets = new Map();
const transcript = [], visible = [], conditionsLog = [];
const at = () => new Date().toISOString();
const add = (label, value) => { if (typeof value === "string" && value.length >= 8) secrets.set(value, label); };
const redact = text => { let result = text; for (const [value, label] of [...secrets].sort((a, b) => b[0].length - a[0].length)) result = result.split(value).join("[redacted " + label + "]"); return result; };
const started = Date.now();
let result, failure = null, media = null, versions = null, release = null, databaseRole = null;
try {
 result = await withDatabase(async databaseUrl => {
  const fixture = await watchFixture(databaseUrl);
  const browser = await chromium.launch();
  try {
   for (const key of fixture.f.config.cookieKeys) add("issuer cookie key", key);
   add("lifecycle key", fixture.f.config.lifecycleKey);
   add("login mail key", fixture.f.config.loginMailKey);
   add("control signing secret", fixture.f.controlConfig.secret);
   for (const key of Object.values(fixture.config.unsubscribe.keys)) add("unsubscribe signing key", key);
   add("mail API key", fixture.env.SCOAT_FIXTURE_MAIL_KEY);
   const pg = (await fixture.pool.query("SELECT version() AS v")).rows[0].v;
   databaseRole = (await fixture.pool.query("SELECT rolsuper AS superuser, rolcreatedb AS createdb, rolcreaterole AS createrole, rolreplication AS replication, rolbypassrls AS bypassrls FROM pg_roles WHERE rolname = current_user")).rows[0];
   versions = { node: process.version, postgresServer: pg, pgDump: (await exec(path.join(pgTools.bin, "pg_dump"), ["--version"], { env: pgTools.env })).stdout.trim(), chromium: browser.version(), ffmpeg: ffmpeg.version ?? null, ffprobe: ffprobe.version ?? null };
   release = JSON.parse(await readFile("dist/release.json", "utf8")).digest;
   const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 760 }, recordVideo: { dir: evidence, size: { width: 1100, height: 760 } } });
   await context.addInitScript(maskStatus);
   const page = await context.newPage();
   await page.addInitScript(() => { window.open = () => null; });
   await page.setContent(`<body style="font:16px system-ui;margin:40px"><h1>Scoat P09 linked story</h1><p>Recorded local run at ${head.slice(0, 12)}. Native Chromium pages follow; MCP steps run between them.</p></body>`);
   const record = entry => { const item = { at: at(), kind: "synthetic-condition", ...entry }; conditionsLog.push(item); transcript.push(item); };
   const conditions = storyConditions(fixture, record);
   let outcome;
   try {
    outcome = await linkedStory({ fixture, conditions, page, evidence, log: entry => transcript.push({ at: at(), ...entry }), secrets: { add }, visible: entry => visible.push({ at: at(), ...entry }), dwell: () => page.waitForTimeout(dwellMilliseconds) });
   } finally {
    for (const cookie of await context.cookies().catch(() => [])) { add("browser cookie value", cookie.value); add("browser cookie name", cookie.name); };
    const video = page.video();
    await context.close();
    const source = await video?.path().catch(() => null);
    if (source) { await rename(source, path.join(evidence, "p09-review.source.webm")); }
    const process = fixture.workerProcess();
    if (process) process.kill("SIGCONT");
   }
   return outcome;
  } finally {
   await browser.close().catch(() => undefined);
   await fixture.close();
  }
 });
 const webm = path.join(evidence, "p09-review.source.webm"), mp4 = path.join(evidence, "p09-review.mp4");
 if (ffmpeg.missing || ffprobe.missing) media = { status: "BLOCKED", missing: [ffmpeg.missing, ffprobe.missing].filter(Boolean), source: webm };
 else {
  await exec(ffmpeg.file, ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], { timeout: 300000 });
  const probe = JSON.parse((await exec(ffprobe.file, ["-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height", "-of", "json", mp4])).stdout);
  const seconds = Number(probe.format.duration);
  media = { status: seconds >= 30 && seconds <= 60 ? "PASS" : "FAIL", seconds, streams: probe.streams, mp4, source: webm, recording: "Playwright recordVideo of the single story page; transcoded once with " + ffmpeg.file + "; review dwell " + dwellMilliseconds + " ms after each screenshot" };
  assert.equal(media.status, "PASS", "Video duration " + seconds + " s is outside 30-60 s");
 }
} catch (error) {
 failure = String(error?.stack ?? error);
}
const write = async (name, text) => writeFile(path.join(evidence, name), redact(text));
await write("transcript.jsonl", transcript.map(item => JSON.stringify(item)).join("\n") + "\n");
await write("visible.jsonl", visible.map(item => JSON.stringify(item)).join("\n") + "\n");
if (result) await write("projection.json", JSON.stringify(result.projection, null, 1));
if (failure) await write("failure.txt", failure);
const files = (await readdir(evidence)).sort();
const leaks = [];
for (const entry of visible) for (const [value, label] of secrets) if (entry.text.includes(value) || entry.url.includes(value)) leaks.push({ source: "browser-visible " + entry.screenshot, label });
for (const file of files.filter(name => /\.(jsonl?|txt)$/.test(name))) { const text = await readFile(path.join(evidence, file), "utf8"); for (const [value, label] of secrets) if (text.includes(value)) leaks.push({ source: file, label }); }
const binary = [];
for (const file of files.filter(name => /\.(png|mp4|webm)$/.test(name))) { const bytes = await readFile(path.join(evidence, file)); binary.push({ file, sha256: sha(bytes), bytes: bytes.length, literalSecretMatches: [...secrets].filter(([value]) => bytes.includes(Buffer.from(value))).length }); }
const screenshots = ["memory", "card", "control", "watch", "mail", "unsubscribe", "erase"].map(name => "p09-review-" + name + ".png");
const status = failure ? "FAIL" : leaks.length ? "FAIL" : media?.status === "BLOCKED" ? "BLOCKED" : screenshots.every(name => files.includes(name)) ? "PASS_LOCAL_ONLY" : "FAIL";
const receipt = {
 status, ...identity, evidence, seconds: (Date.now() - started) / 1000, release: { manifestDigest: release, health: result?.startup.healthDigest ?? null, worker: result?.startup.workerDigest ?? null },
 versions, hardware: { cpu: os.cpus()[0]?.model ?? "unknown", cpus: os.cpus().length, arch: os.arch(), memoryBytes: os.totalmem(), platform: os.platform() + " " + os.release() },
 steps: result?.steps.map(({ step, status: state, seconds }) => ({ step, status: state, seconds })) ?? [], results: result?.steps ?? [], ids: result?.ids ?? null, conditions: conditionsLog,
 boundaries: { mcp: "SDK 1.32.2 StreamableHTTP clients host-one and host-two over local HTTPS with bearer tokens from authorization code + PKCE", identity: "SYNTHETIC local Resend-contract mail capture; stable local subjects; native email-code verification", seller: "SYNTHETIC local TLS server replaying the recorded Pi Hut product and delivery pages", mail: "local TLS Resend-contract capture process; no external provider", browser: "headless Playwright Chromium drives the native issuer pages for memory approval, Skip/Stop controls, watch confirmation, unsubscribe and erase, plus the card harness",
  oauthLogin: "SCRIPTED fixture cookie-jar HTTPS client (auth-fixture login): real issuer authorization-code + PKCE S256 endpoints with consent forms parsed from HTML; not native-browser OAuth login or consent", card: "real dist/card bundle in the scripts/card-host.mjs AppBridge harness; openLink followed in the same recorded tab", database: "real PostgreSQL with isolated application and pg-boss schemas; the application connects as the role in databaseRole (the embedded fixture cluster is its initdb trust superuser unless DATABASE_URL names another role); NOSUPERUSER owners are exercised by the lineage, recovery and perf-lineage lanes, not this story",
  databaseRole, fixtureInfrastructure: "auth fixture creates its schema, login mail capture, issuer and keys; watch fixture creates the queue schema, seller and capture; these are not story actions" },
 untested: ["real MCP hosts", "live Resend and DKIM", "live seller and checkout", "model agent", "managed PostgreSQL", "actual systemd deployment and key rotation", "production acceptance", "fixed two-CPU runner", "native-browser OAuth login and consent", "application database role without superuser in the story", "trunk comparison (no runnable hunt on trunk)"],
 media: { video: media, screenshots, binaryScan: { files: binary, limit: "Byte search for literal secret strings only; it cannot prove pixels omit a secret. Masking happens before capture: status secrets are replaced in the DOM by an init-script MutationObserver, and mail recipient and one-click values are replaced before rendering." } },
 secretScan: { values: secrets.size, labels: [...new Set(secrets.values())].sort(), textFiles: files.filter(name => /\.(jsonl?|txt)$/.test(name)), visibleCaptures: visible.length, leaks },
 timing: "Per-step wall seconds from one run on this hardware, including review dwell; not a performance benchmark",
 failure: failure ? failure.slice(0, 4000) : null,
};
await writeFile(path.join(evidence, "receipt.json"), redact(JSON.stringify(receipt, null, 1)));
process.stdout.write(redact(JSON.stringify({ status, evidence, head, clean: identity.clean, steps: receipt.steps.length, video: media?.seconds ?? media?.status ?? null, leaks: leaks.length, failure: failure ? failure.slice(0, 600) : null })) + "\n");
process.exitCode = status === "PASS_LOCAL_ONLY" ? 0 : status === "BLOCKED" ? 2 : 1;
