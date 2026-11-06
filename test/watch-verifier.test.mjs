import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { chromium } from "playwright";
import { postWatchForm } from "../scripts/watch-browser.mjs";
import { closeWatchBrowser, stopFixtureProcess } from "../scripts/watch-resources.mjs";
import { withDatabase } from "../scripts/durable-database.mjs";
import { scratchDirectory } from "../scripts/scratch.mjs";

test("native Watch POST waits for the new refusal under a delayed response", async t => {
 const server = createServer(async (req, res) => {
  req.resume();
  if (req.method === "POST") {
   await delay(350);
   res.writeHead(409, { "content-type": "text/html", "cache-control": "no-store" });
   res.end("<p>This confirmation expired or was already used.</p>");
  } else res.end("<p>The public price shown is more than two minutes old.</p>");
 });
 t.after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
 });
 server.listen(0, "127.0.0.1");
 await once(server, "listening");
 const browser = await chromium.launch();
 t.after(() => browser.close());
 const page = await browser.newPage();
 await page.route("**/account/watch", async route => {
  if (route.request().method() === "POST") await delay(350);
  await route.continue();
 });
 await page.goto("http://127.0.0.1:" + server.address().port + "/account/watch");
 await page.evaluate(() => {
  const submit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () { setTimeout(() => submit.call(this), 350); };
 });
 const response = page.waitForResponse(reply => reply.request().method() === "POST");
 const text = await postWatchForm(page, [["confirmation", "used-fixture"], ["decision", "watch"], ["target", "60.00"]]);
 assert.equal((await response).status(), 409);
 assert.match(text, /expired or was already used/);
});

test("fixture shutdown kills an unresponsive child and accepts an already signalled exit", { timeout: 5000 }, async () => {
 const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);process.send('ready')"], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
 try {
  await once(child, "message");
  await stopFixtureProcess(child, "SIGTERM", 50);
  assert.equal(child.signalCode, "SIGKILL");
  await stopFixtureProcess(child);
 } finally { child.kill("SIGKILL"); }
});

test("browser shutdown terminates a pending navigation", { timeout: 10000 }, async t => {
 const server = createServer(req => req.resume());
 t.after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
 });
 server.listen(0, "127.0.0.1");
 await once(server, "listening");
 const browserServer = await chromium.launchServer();
 t.after(() => browserServer.kill());
 const browser = await chromium.connect(browserServer.wsEndpoint());
 const page = await browser.newPage();
 const request = once(server, "request");
 const navigation = page.goto("http://127.0.0.1:" + server.address().port).catch(() => undefined);
 await request;
 await closeWatchBrowser(browserServer);
 await navigation;
 assert.equal(browser.isConnected(), false);
 assert.ok(browserServer.process().exitCode !== null || browserServer.process().signalCode !== null);
});

test("missing Chromium fails browser regressions without leaving HTTP servers open", { timeout: 10000 }, async () => {
 const browsers = await scratchDirectory("missing-chromium-");
 const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers };
 delete env.NODE_TEST_CONTEXT;
 const child = spawn(process.execPath, ["--test", "--test-reporter=spec", "--test-name-pattern=^(native Watch POST|browser shutdown)", "test/watch-verifier.test.mjs"], { stdio: ["ignore", "pipe", "pipe"], env });
 let output = "";
 child.stdout.on("data", chunk => { output += chunk; });
 child.stderr.on("data", chunk => { output += chunk; });
 try {
  const [code, signal] = await once(child, "close", { signal: AbortSignal.timeout(8000) });
  assert.equal(signal, null, output);
  assert.equal(code, 1, output);
  assert.match(output, /Executable doesn't exist/);
  assert.match(output, /fail 2/);
  assert.doesNotMatch(output, /cancelled 1|test_file_timeout/);
 } finally {
  await stopFixtureProcess(child, "SIGKILL");
  await rm(browsers, { recursive: true, force: true });
 }
});

test("P08 exits nonzero after a live-worker lane failure with no processes, schemas or pools left", { timeout: 90000 }, async t => {
 await withDatabase(async url => {
  const evidence = await scratchDirectory("p08-failure-");
  const admin = new pg.Pool({ connectionString: url });
  const name = "watch_failure_" + randomBytes(8).toString("hex");
  const target = new URL(url);
  target.pathname = "/" + name;
  const pool = new pg.Pool({ connectionString: target.href });
  let child;
  let created = false;
  try {
   await admin.query("CREATE DATABASE " + name);
   created = true;
   const inventory = async () => (await pool.query("SELECT nspname FROM pg_namespace WHERE nspname ~ '^(auth_|scoat_jobs_)' ORDER BY nspname")).rows;
   const before = await inventory();
   await mkdir(path.join(evidence, "p08-lane-1.json"));
   child = spawn(process.execPath, ["scripts/verify.mjs", "p08"], { detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: target.href, SCOAT_EVIDENCE_DIR: evidence, SCOAT_P08_FORM_DELAY_MS: "350" } });
   let output = "";
   let failedAt;
   const capture = chunk => { output = (output + chunk).slice(-12000); if (String(chunk).includes("P08 lane failure:")) failedAt ??= Date.now(); };
   child.stdout.on("data", capture);
   child.stderr.on("data", capture);
   const started = Date.now();
   const [code, signal] = await once(child, "exit", { signal: AbortSignal.timeout(45000) });
   assert.equal(signal, null, output);
   assert.equal(code, 1, output);
   assert.match(output, /P08 lane failure:.*EISDIR/);
   assert.ok(Date.now() - started < 45000);
   const failureToExitMilliseconds = Date.now() - failedAt;
   assert.ok(failureToExitMilliseconds < 15000, "cleanup exceeded 15 seconds: " + failureToExitMilliseconds);
   assert.doesNotMatch(output, /PASS_LOCAL_ONLY|watch_fixture_close/);
   assert.deepEqual(await inventory(), before);
   assert.equal((await pool.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")).rows[0].n, 0);
   if (process.platform === "linux") {
    const marker = Buffer.from("SCOAT_EVIDENCE_DIR=" + evidence + "\0");
    const survivors = [];
    for (const pid of (await readdir("/proc")).filter(name => /^\d+$/.test(name))) {
     const env = await readFile("/proc/" + pid + "/environ").catch(() => Buffer.alloc(0));
     if (env.includes(marker)) survivors.push(pid);
    }
    assert.deepEqual(survivors, []);
   }
   t.diagnostic(JSON.stringify({ exitCode: code, failureToExitMilliseconds, survivingProcesses: 0, privateSchemas: 0, databaseClients: 0 }));
  } finally {
   if (child) {
    try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    await stopFixtureProcess(child, "SIGKILL");
   }
   await pool.end();
   if (created) await admin.query("DROP DATABASE " + name);
   await admin.end();
   await rm(evidence, { recursive: true, force: true });
  }
 });
});
