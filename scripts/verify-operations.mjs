import assert from "node:assert/strict";
import { execFile, fork } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, cp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { withDatabase } from "./durable-database.mjs";
import { scratchDirectory } from "./scratch.mjs";
import { authFixture } from "./auth-fixture.mjs";
import { seal, unseal } from "../dist/db/lineage.js";
import { verifyRelease, releaseDirectories, releaseFiles, releaseManifest } from "../dist/release.js";
import { health } from "../dist/readiness.js";
import { queueSchemaFor } from "../dist/queue/index.js";

const exec = promisify(execFile);
const checkout = new URL("..", import.meta.url).pathname;
const root = await scratchDirectory("operations-", path.join(os.homedir(), "tmp/scoat-delivery/p09/s3"));
const gates = [];
const sha = text => createHash("sha256").update(text).digest("hex");
const git = async args => (await exec("git", args, { cwd: checkout, maxBuffer: 1 << 26 })).stdout;
const children = [];

async function gate(name, run) {
 try {
  gates.push({ name, status: "PASS", detail: await run() ?? null });
 } catch (error) {
  gates.push({ name, status: "FAIL", error: String(error?.stack ?? error).slice(0, 4000) });
  process.exitCode = 1;
 }
}

function start(entry, env, timeout = 30000) {
 const child = fork(entry, [], { execArgv: [], silent: true, cwd: path.dirname(entry), env: { PATH: process.env.PATH, ...env } });
 children.push(child);
 const output = { stdout: "", stderr: "" };
 child.stdout.on("data", chunk => { output.stdout += chunk; });
 child.stderr.on("data", chunk => { output.stderr += chunk; });
 const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
 const first = new Promise(resolve => {
  const timer = setTimeout(() => { child.kill("SIGKILL"); resolve({ kind: "timeout" }); }, timeout);
  child.once("message", message => { clearTimeout(timer); resolve({ kind: "message", message }); });
  exited.then(result => { clearTimeout(timer); resolve({ kind: "exit", ...result }); });
 });
 return { child, output, exited, first, async stop() { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await exited; } } };
}

function raw(host, port, headers, pathname = "/healthz") {
 return new Promise((resolve, reject) => {
  const outgoing = request({ host, port, path: pathname, method: "GET", headers, timeout: 5000 }, response => {
   let body = "";
   response.on("data", chunk => { body += chunk; });
   response.on("end", () => resolve({ status: response.statusCode, cacheControl: response.headers["cache-control"], body }));
  });
  outgoing.on("error", reject);
  outgoing.on("timeout", () => outgoing.destroy(new Error("request timeout")));
  outgoing.end();
 });
}

async function healthOf(base) {
 const response = await fetch(base + "/healthz");
 return { status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.json() };
}

async function releaseCopy(name) {
 const target = path.join(root, name);
 for (const directory of releaseDirectories) await cp(path.join(checkout, directory), path.join(target, directory), { recursive: true });
 for (const file of releaseFiles) await cp(path.join(checkout, file), path.join(target, file));
 await symlink(path.join(checkout, "node_modules"), path.join(target, "node_modules"));
 return target;
}

const environment = { node: process.version, cpu: os.cpus()[0]?.model ?? "unknown", logicalCpus: os.cpus().length, platform: `${os.platform()} ${os.release()} ${os.arch()}` };
let shipped;

await gate("O1 building twice from the same inputs yields one stable verified digest", async () => {
 const builds = [];
 for (let n = 0; n < 2; n++) {
  const { stdout } = await exec("npm", ["run", "build", "--silent"], { cwd: checkout, maxBuffer: 1 << 24 });
  const line = stdout.trim().split("\n").filter(item => item.startsWith("{\"release\"")).at(-1);
  assert.ok(line, "build printed no release digest");
  builds.push(JSON.parse(line).release);
 }
 assert.equal(builds[0], builds[1]);
 const verified = await verifyRelease();
 assert.equal(verified.kind, "verified");
 assert.equal(verified.release.digest, builds[0]);
 const manifest = JSON.parse(await readFile(path.join(checkout, releaseManifest), "utf8"));
 assert.ok(!manifest.inputs.some(input => input.path === releaseManifest), "manifest hashes itself");
 shipped = builds[0];
 return { digest: shipped, builds, inputs: manifest.inputs.length, directories: releaseDirectories, files: releaseFiles };
});

await gate("O2 absent, malformed or changed release metadata refuses server readiness, worker start and migrate", async () => {
 const copy = await releaseCopy("release-copy");
 const relocated = await verifyRelease(copy);
 assert.equal(relocated.kind, "verified");
 assert.equal(relocated.release.digest, shipped);
 const outcomes = {};
 const watchConfig = path.join(root, "worker-watch.json");
 await writeFile(watchConfig, JSON.stringify({ issuer: "https://127.0.0.1:9", from: "Scoat alerts <alerts@scoat.invalid>", unsubscribe: { version: "ops-v1", keys: { "ops-v1": randomBytes(32).toString("hex") } }, resendApiKey: "re_fixture_never_sent" }), { mode: 0o600 });
 const unreachable = "postgres://nobody:nothing@127.0.0.1:9/none";
 const probe = async label => {
  const state = await verifyRelease(copy);
  const server = start(path.join(copy, "dist/server.js"), { PORT: "0" });
  const ready = await server.first;
  assert.equal(ready.kind, "message", server.output.stderr);
  const report = await raw("127.0.0.1", ready.message.port, { host: "localhost:" + ready.message.port });
  await server.stop();
  const worker = start(path.join(copy, "dist/worker.js"), { DATABASE_URL: unreachable, SCOAT_WATCH_CONFIG: watchConfig });
  const workerExit = await worker.exited;
  const migrate = await exec(process.execPath, [path.join(copy, "scripts/database.mjs"), "migrate"], { env: { PATH: process.env.PATH, DATABASE_URL: unreachable } }).then(() => ({ code: 0, stderr: "" }), error => ({ code: error.code, stderr: String(error.stderr) }));
  const body = JSON.parse(report.body);
  outcomes[label] = { verify: state.kind === "verified" ? "verified" : state.reason, health: report.status, artifact: body.artifact, reasons: body.reasons, worker: workerExit.code, workerStderr: worker.output.stderr.trim().slice(0, 200), workerReady: worker.output.stdout.includes("worker_ready"), migrate: migrate.code, migrateStderr: migrate.stderr.trim().slice(0, 200) };
  assert.equal(report.cacheControl, "no-store");
  assert.ok(!("phase" in body));
  return { state, body, workerExit, migrate, worker };
 };
 const refusedAs = async (label, reason) => {
  const { state, body, workerExit, migrate, worker } = await probe(label);
  assert.equal(state.kind, "refused");
  assert.equal(state.reason, reason);
  assert.deepEqual(body.artifact, { status: "refused", reason });
  assert.equal(body.ready, false);
  assert.ok(body.reasons.includes(reason));
  assert.equal(workerExit.code, 78);
  assert.match(worker.output.stderr, new RegExp(`"event":"artifact_refused","reason":"${reason}"`));
  assert.ok(!worker.output.stdout.includes("worker_ready"));
  assert.equal(migrate.code, 78);
  assert.match(migrate.stderr, new RegExp(`"reason":"${reason}"`));
 };
 const baseline = await probe("unchanged copy");
 assert.deepEqual(baseline.body.artifact, { status: "verified", digest: shipped });
 assert.notEqual(baseline.workerExit.code, 78);
 const migration = path.join(copy, "db/migrations/0004_lineage.sql");
 const original = await readFile(migration);
 await appendFile(migration, "\n");
 await refusedAs("shipped migration changed", "artifact-inputs-changed");
 await writeFile(migration, original);
 const card = path.join(copy, "dist/card/index.html");
 const cardOriginal = await readFile(card);
 await writeFile(card, Buffer.concat([cardOriginal, Buffer.from("<!-- changed -->")]));
 await refusedAs("shipped card changed", "artifact-inputs-changed");
 await writeFile(card, cardOriginal);
 await writeFile(path.join(copy, "dist/unlisted.js"), "export {};\n");
 await refusedAs("unlisted module added", "artifact-inputs-changed");
 await rm(path.join(copy, "dist/unlisted.js"));
 const manifestPath = path.join(copy, releaseManifest);
 const manifest = await readFile(manifestPath, "utf8");
 await writeFile(manifestPath, manifest.replace(/"digest": "sha256:[0-9a-f]{8}/, "\"digest\": \"sha256:00000000"));
 await refusedAs("manifest digest edited", "artifact-metadata-malformed");
 await writeFile(manifestPath, "{\"format\":\"scoat-release/1\"");
 await refusedAs("manifest truncated", "artifact-metadata-malformed");
 await rm(manifestPath);
 await refusedAs("manifest absent", "artifact-metadata-absent");
 await writeFile(manifestPath, manifest);
 assert.equal((await verifyRelease(copy)).kind, "verified");
 return outcomes;
});

await gate("O3 SCOAT_LISTEN_HOST binds exact IPv4 and IPv6 literals without widening Host or Origin trust", async () => {
 const results = {};
 for (const [label, value, address] of [["default", undefined, "127.0.0.1"], ["ipv4", "127.0.0.1", "127.0.0.1"], ["ipv6", "::1", "::1"]]) {
  const server = start(path.join(checkout, "dist/server.js"), { PORT: "0", ...(value === undefined ? {} : { SCOAT_LISTEN_HOST: value }) });
  const ready = await server.first;
  if (ready.kind !== "message") {
   await server.stop();
   if (label === "ipv6" && /EADDRNOTAVAIL|EAFNOSUPPORT/.test(server.output.stderr)) { results[label] = { status: "UNAVAILABLE-ENV", stderr: server.output.stderr.slice(-300) }; continue; }
   throw new Error(label + " did not bind: " + server.output.stderr.slice(-500));
  }
  const port = ready.message.port;
  assert.equal(ready.message.host, address);
  const loopback = await raw(address, port, { host: "localhost:" + port });
  const literal = await raw(address, port, { host: (address.includes(":") ? "[" + address + "]" : "192.0.2.1") + ":" + port });
  const foreignOrigin = await raw(address, port, { host: "127.0.0.1:" + port, origin: "http://[::1]:" + port });
  const otherFamily = await raw(address === "::1" ? "127.0.0.1" : "::1", port, { host: "localhost:" + port }).then(response => response.status, error => error.code);
  await server.stop();
  assert.equal(loopback.status, 503);
  assert.equal(JSON.parse(loopback.body).artifact.status, "verified");
  assert.equal(literal.status, 403);
  assert.equal(foreignOrigin.status, 403);
  assert.equal(otherFamily, "ECONNREFUSED");
  results[label] = { bound: address, port, loopbackHostHealth: loopback.status, literalHost: literal.status, foreignOrigin: foreignOrigin.status, otherFamily };
 }
 for (const value of ["localhost", "fe80::1%lo", "127.0.0.1:80", "", "::ffff:127.0.0.1x"]) {
  const server = start(path.join(checkout, "dist/server.js"), { PORT: "0", SCOAT_LISTEN_HOST: value });
  const outcome = await server.first;
  assert.equal(outcome.kind, "exit", "server bound a non-literal " + value);
  assert.equal(outcome.code, 78);
  assert.match(server.output.stderr, /"event":"configuration_refused","reason":"listen-host-not-ip-literal"/);
  results["refused " + JSON.stringify(value)] = outcome.code;
 }
 return results;
});

await withDatabase(async adminUrl => {
 const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
 const suffix = randomBytes(4).toString("hex");
 const role = "s3_owner_" + suffix, password = randomBytes(18).toString("hex");
 const databases = [];
 const pools = [];
 let fixture = null;
 const database = async (name, template) => {
  const db = name + "_" + suffix;
  await admin.query(`CREATE DATABASE ${db} OWNER ${role}` + (template ? ` TEMPLATE ${template}` : ""));
  databases.push(db);
  const url = new URL(adminUrl);
  url.username = role;
  url.password = password;
  url.pathname = "/" + db;
  return { name: db, url: url.href };
 };
 const open = url => { const pool = new pg.Pool({ connectionString: url, max: 2 }); pool.on("error", () => undefined); pools.push(pool); return pool; };
 const migrate = url => exec(process.execPath, ["scripts/database.mjs", "migrate"], { cwd: checkout, env: { PATH: process.env.PATH, DATABASE_URL: url } });
 try {
  await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
  Object.assign(environment, (await admin.query("SELECT current_setting('server_version') AS postgres, (SELECT rolsuper FROM pg_roles WHERE rolname = $1) AS ownerSuperuser", [role])).rows[0]);
  const live = await database("s3_live");
  fixture = await authFixture(live.url);
  const f = fixture;
  const ops = await database("s3_ops");
  await migrate(ops.url);
  const copy = await database("s3_copy", ops.name);
  const watchConfig = path.join(root, "watch.json");
  await writeFile(watchConfig, JSON.stringify({ issuer: f.issuer, from: "Scoat alerts <alerts@scoat.invalid>", unsubscribe: { version: "ops-v1", keys: { "ops-v1": randomBytes(32).toString("hex") } }, resendApiKey: "re_fixture_never_sent" }), { mode: 0o600 });
  const serverEnv = url => ({ PORT: "0", DATABASE_URL: url, SCOAT_AUTH_CONFIG: f.root + "/auth.json", SCOAT_CONTROL_CONFIG: f.root + "/control.json", SCOAT_KNOWLEDGE_DIRECTORY: f.root + "/releases", SCOAT_TLS_KEY: f.root + "/key.pem", SCOAT_TLS_CERT: f.root + "/cert.pem", NODE_EXTRA_CA_CERTS: f.root + "/cert.pem" });
  const server = start(path.join(checkout, "dist/server.js"), serverEnv(ops.url), 60000);
  const ready = await server.first;
  assert.equal(ready.kind, "message", server.output.stderr);
  const base = "https://localhost:" + ready.message.port;
  const opsPool = open(ops.url);

  await gate("O4 admitted readiness: server health and production worker ready event carry the identical artifact digest", async () => {
   const fixtureHealth = await healthOf(f.issuer);
   const opsHealth = await healthOf(base);
   for (const report of [fixtureHealth, opsHealth]) {
    assert.equal(report.status, 200, JSON.stringify(report.body));
    assert.equal(report.cacheControl, "no-store");
    assert.deepEqual(report.body, { ready: true, reasons: [], artifact: { status: "verified", digest: shipped }, database: "available", schema: { expected: "0004_lineage", current: "0004_lineage", status: "current" }, lineage: "admitted", auth: "configured", transport: "https" });
   }
   const mcp = await fetch(base + "/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
   assert.equal(mcp.status, 401);
   const worker = start(path.join(checkout, "dist/worker.js"), { DATABASE_URL: ops.url, SCOAT_WATCH_CONFIG: watchConfig }, 60000);
   const announced = await worker.first;
   assert.equal(announced.kind, "message", worker.output.stderr);
   assert.deepEqual(announced.message, { ready: true, artifact: shipped });
   assert.match(worker.output.stdout, new RegExp(`\\{"event":"worker_ready","artifact":"${shipped}"\\}`));
   const queueSchema = await queueSchemaFor(opsPool);
   const queues = (await opsPool.query("SELECT count(*)::integer AS count FROM pg_namespace WHERE nspname = $1", [queueSchema])).rows[0].count;
   await worker.stop();
   const work = (await opsPool.query("SELECT (SELECT count(*) FROM watches)::integer AS watches, (SELECT count(*) FROM watch_alerts)::integer AS alerts")).rows[0];
   assert.equal(queues, 1, "worker announced ready without its queue schema");
   assert.deepEqual(work, { watches: 0, alerts: 0 });
   return { serverDigest: opsHealth.body.artifact.digest, fixtureServerDigest: fixtureHealth.body.artifact.digest, workerDigest: announced.message.artifact, mcpWithoutCredential: mcp.status, queueSchema, queueSchemaPresent: queues === 1, outboundWork: work };
  });

  await gate("O5 sealed lineage fails health and requests closed, worker never announces ready, and unseal restores readiness", async () => {
   const { sealId } = await seal(opsPool);
   const sealed = await healthOf(base);
   const mcp = await fetch(base + "/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
   const worker = start(path.join(checkout, "dist/worker.js"), { DATABASE_URL: ops.url, SCOAT_WATCH_CONFIG: watchConfig }, 60000);
   const outcome = await worker.first;
   await unseal(opsPool, sealId);
   const reopened = await healthOf(base);
   assert.equal(sealed.status, 503);
   assert.equal(sealed.body.lineage, "sealed");
   assert.deepEqual(sealed.body.reasons, ["lineage-sealed"]);
   assert.equal(mcp.status, 503);
   assert.equal(outcome.kind, "exit");
   assert.equal(outcome.code, 78);
   assert.ok(!worker.output.stdout.includes("worker_ready"));
   assert.equal(reopened.status, 200);
   return { sealed: sealed.body.reasons, mcp: mcp.status, worker: outcome.code, reopened: reopened.status };
  });

  await gate("O6 database outage reports 503 with a bounded reason, keeps credentials out of output, and recovers without restart", async () => {
   let down, mcp, alive;
   try {
    await admin.query(`ALTER DATABASE ${ops.name} ALLOW_CONNECTIONS false`);
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [ops.name]);
    await new Promise(resolve => setTimeout(resolve, 500));
    alive = server.child.exitCode === null && server.child.signalCode === null;
    assert.ok(alive, "server exited during the database outage: " + server.output.stderr.slice(-300));
    down = await healthOf(base);
    mcp = await fetch(base + "/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
   } finally {
    await admin.query(`ALTER DATABASE ${ops.name} ALLOW_CONNECTIONS true`);
   }
   const up = await healthOf(base);
   assert.equal(down.status, 503);
   assert.deepEqual(down.body.reasons, ["database-unavailable"]);
   assert.deepEqual(down.body.schema, { expected: "0004_lineage", current: null, status: "unknown" });
   assert.equal(mcp.status, 503);
   assert.equal(up.status, 200);
   const output = JSON.stringify(down) + server.output.stdout + server.output.stderr;
   for (const secret of [password, ops.url]) assert.ok(!output.includes(secret), "output leaked a credential");
   return { down: down.body, mcp: mcp.status, recovered: up.status, serverStderrEvents: [...new Set(server.output.stderr.split("\n").filter(Boolean).map(line => line.slice(0, 80)))] };
  });

  await gate("O7 copied database and schema drift fail closed with bounded reasons", async () => {
   const copied = start(path.join(checkout, "dist/server.js"), serverEnv(copy.url), 60000);
   const outcome = await copied.first;
   assert.equal(outcome.kind, "exit");
   assert.equal(outcome.code, 78);
   assert.match(copied.output.stderr, /"event":"lineage_refused","reason":"identity-mismatch"/);
   const verified = await verifyRelease();
   const copyReport = await health(verified, open(copy.url), true, true);
   assert.equal(copyReport.ready, false);
   assert.deepEqual(copyReport.reasons, ["lineage-identity-mismatch"]);
   await opsPool.query("UPDATE scoat_lineage SET schema_head = '0005_future_release'");
   const drift = await healthOf(base);
   assert.equal(drift.status, 503);
   assert.deepEqual(drift.body.schema, { expected: "0004_lineage", current: "0005_future_release", status: "drift" });
   assert.deepEqual(drift.body.reasons, ["schema-drift", "lineage-schema-ahead"]);
   return { copyServerExit: outcome.code, copyReasons: copyReport.reasons, drift: drift.body.schema, driftReasons: drift.body.reasons, label: "schema drift is emulated by an owner-role lineage write on a disposable database" };
  });
  await server.stop();
 } finally {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  if (fixture) await fixture.close().catch(error => gates.push({ name: "auth fixture cleanup", status: "FAIL", error: String(error) }));
  for (const pool of pools) await pool.end().catch(() => undefined);
  for (const db of databases) {
   await admin.query(`ALTER DATABASE ${db} ALLOW_CONNECTIONS true`).catch(() => undefined);
   await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [db]);
   await admin.query(`DROP DATABASE IF EXISTS ${db}`);
  }
  await admin.query(`DROP ROLE IF EXISTS ${role}`);
  await admin.end();
 }
});

await gate("O8 systemd units verify with one release directory, one environment file and terminal exit 78", async () => {
 const units = ["scoat-migrate", "scoat-server", "scoat-worker"].map(name => path.join(checkout, "deploy/systemd", name + ".service"));
 const analyze = await exec("systemd-analyze", ["--version"]).then(result => result.stdout.split("\n")[0], () => null);
 if (analyze === null) return { status: "UNTESTED", reason: "systemd-analyze unavailable on this host" };
 const verified = await exec("systemd-analyze", ["verify", ...units]).then(result => ({ code: 0, stderr: result.stderr }), error => ({ code: error.code, stderr: String(error.stderr) }));
 const ours = verified.stderr.split("\n").filter(line => line.includes("scoat-"));
 if (verified.code !== 0) process.stderr.write(JSON.stringify({ gate: "O8", code: verified.code, stderr: verified.stderr.slice(0, 4000) }) + "\n");
 assert.equal(verified.code, 0, verified.stderr);
 assert.deepEqual(ours, []);
 return { systemd: analyze, units: units.map(unit => path.basename(unit)), deployed: "not deployed: release /opt/scoat/release and /etc/scoat/scoat.env are placeholders on this host" };
});

const receipt = {
 scope: "P09 S3 operations: release digest, readiness, listen host, deploy units (not the P09 public story)",
 head: (await git(["rev-parse", "HEAD"])).trim(),
 porcelain: await git(["status", "--porcelain"]),
 trackedPatchSha256: sha(await git(["diff", "HEAD"])),
 environment,
 gates,
 untested: ["managed PostgreSQL permissions and failover", "real hosts, IdP, Resend and DKIM", "actual systemd deployment", "fixed two-CPU runner"],
};
await writeFile(path.join(root, "receipt.json"), JSON.stringify(receipt, null, 1) + "\n");
process.stdout.write(JSON.stringify({ receipt: path.join(root, "receipt.json"), gates: gates.map(item => item.name + ": " + item.status) }, null, 1) + "\n");
