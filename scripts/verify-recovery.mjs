import assert from "node:assert/strict";
import { execFile, fork } from "node:child_process";
import { promisify } from "node:util";
import { access, cp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { withDatabase } from "./durable-database.mjs";
import { scratchDirectory } from "./scratch.mjs";
import { baseArtifact, postgresClientTools } from "./lane-tools.mjs";
import { watchFixture } from "./watch-fixture.mjs";
import { confirm } from "./memory-lanes.mjs";
import { admit, inspect, unseal, locateTarget, consumeSource, LineageRefused } from "../dist/db/lineage.js";
import { retryTransaction } from "../dist/db/transaction.js";
import { admitTarget } from "../dist/recovery/handoff.js";
import { RecoveryRefused } from "../dist/recovery/tools.js";
import { createIssuer, InvalidCredential } from "../dist/auth/issuer.js";
import { WatchQueue } from "../dist/queue/index.js";

const exec = promisify(execFile);
const checkout = new URL("..", import.meta.url).pathname;
const clientTools = postgresClientTools();
const root = await scratchDirectory("recovery-", path.join(os.homedir(), "tmp/scoat-delivery/p09/s2"));
const migrations = path.join(checkout, "db/migrations");
const gates = [];
const refusedWith = reason => error => (error instanceof LineageRefused || error instanceof RecoveryRefused) && error.reason === reason;
class Blocked extends Error {}

async function gate(name, run) {
 try {
  gates.push({ name, status: "PASS", detail: await run() ?? null });
 } catch (error) {
  gates.push({ name, status: error instanceof Blocked ? "BLOCKED" : "FAIL", error: String(error?.stack ?? error).slice(0, 4000) });
  process.exitCode = 1;
 }
}
const inSchema = (url, schema) => { const value = new URL(url); value.searchParams.set("options", "-c search_path=" + schema); return value.href; };
const plain = url => { const value = new URL(url); value.search = ""; return value.href; };
const withoutPassword = url => { const value = new URL(plain(url)); const password = decodeURIComponent(value.password); value.password = ""; return { dbname: value.href, password }; };
const rawTool = (name, args, url) => { const { dbname, password } = withoutPassword(url); return exec(path.join(clientTools.bin, name), [...args, "--dbname=" + dbname], { env: { ...clientTools.env, PGPASSWORD: password }, maxBuffer: 1 << 26 }); };
const sha = text => createHash("sha256").update(text).digest("hex");
const until = async (label, check, timeout = 60000) => { const started = Date.now(); for (;;) { const value = await check(); if (value) return value; if (Date.now() - started > timeout) throw new Error("Timed out waiting for " + label); await new Promise(resolve => setTimeout(resolve, 200)); } };

async function cli(args, env, secrets) {
 let result;
 try {
  const { stdout, stderr } = await exec(process.execPath, [path.join(checkout, "dist/recovery.js"), ...args], { cwd: checkout, env: { PATH: process.env.PATH, ...clientTools.cliEnv, ...env }, maxBuffer: 1 << 22 });
  result = { code: 0, out: JSON.parse(stdout.trim()), stderr };
 } catch (error) {
  if (typeof error.code !== "number") throw error;
  const last = String(error.stderr).trim().split("\n").at(-1) ?? "";
  result = { code: error.code, out: null, stderr: String(error.stderr), refusal: last.startsWith("{") ? JSON.parse(last) : null };
 }
 for (const secret of secrets) assert.ok(!JSON.stringify(result).includes(secret), "CLI output leaked a credential");
 return result;
}

function launchRefused(entry, env, timeout = 30000) {
 return new Promise((resolve, reject) => {
  const child = fork(entry, [], { execArgv: [], silent: true, cwd: checkout, env: { ...process.env, ...env } });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdout.resume();
  const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Process did not exit: " + entry)); }, timeout);
  child.once("message", () => { clearTimeout(timer); child.kill("SIGKILL"); reject(new Error("Process became ready on a refused database: " + entry)); });
  child.once("exit", code => { clearTimeout(timer); resolve({ code, stderr: stderr.slice(-2000) }); });
 });
}

function launchReady(entry, env) {
 return new Promise((resolve, reject) => {
  const child = fork(entry, [], { execArgv: [], silent: true, cwd: path.dirname(entry.pathname), env });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Worker startup timeout " + output.slice(-2000))); }, 60000);
  child.once("message", () => { clearTimeout(timer); resolve({ child, output: () => output }); });
  child.once("exit", code => { clearTimeout(timer); reject(new Error("Worker exited " + code + " " + output.slice(-2000))); });
 });
}
const stop = child => new Promise(resolve => { if (child.exitCode !== null) { resolve(child.exitCode); return; } const timer = setTimeout(() => child.kill("SIGKILL"), 15000); child.once("exit", code => { clearTimeout(timer); resolve(code); }); child.kill("SIGTERM"); });

async function digest(url) {
 const pool = new pg.Pool({ connectionString: plain(url), max: 1 });
 try {
  const schemas = (await pool.query("SELECT array_agg(nspname::text ORDER BY nspname) AS names FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'")).rows[0].names;
  const tables = (await pool.query("SELECT schemaname::text AS schema, tablename::text AS name FROM pg_tables WHERE schemaname = ANY($1) ORDER BY 1, 2", [schemas])).rows;
  const rows = {};
  for (const table of tables) rows[table.schema + "." + table.name] = (await pool.query(`SELECT count(*)::integer AS count, coalesce(md5(string_agg(to_jsonb(x)::text, '|' ORDER BY to_jsonb(x)::text)), '') AS digest FROM "${table.schema}"."${table.name}" x`)).rows[0];
  const catalog = (await pool.query("SELECT count(*)::integer AS objects, md5(string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || coalesce((SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped), ''), '|' ORDER BY n.nspname, c.relname)) AS digest FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ANY($1)", [schemas])).rows[0];
  const functions = (await pool.query("SELECT md5(string_agg(n.nspname || '.' || p.proname || ':' || md5(p.prosrc), '|' ORDER BY n.nspname, p.proname)) AS digest FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ANY($1)", [schemas])).rows[0].digest;
  return { schemas, rows, catalog, functions };
 } finally { await pool.end(); }
}

function barrier() {
 let signal, release;
 const reached = new Promise(resolve => { signal = resolve; });
 const opened = new Promise(resolve => { release = resolve; });
 return { reached, release: () => release(), at: point => async current => { if (current === point) { signal(); await opened; } } };
}

async function migrationsWith(name, sql) {
 const folder = path.join(root, name);
 await cp(migrations, folder, { recursive: true });
 const journalPath = path.join(folder, "meta/_journal.json");
 const journal = JSON.parse(await readFile(journalPath, "utf8"));
 const last = journal.entries.at(-1);
 journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1000, tag: "0005_recovery_probe" });
 await writeFile(journalPath, JSON.stringify(journal, null, 2));
 await writeFile(path.join(folder, "0005_recovery_probe.sql"), sql);
 return folder;
}

await withDatabase(async adminUrl => {
 const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
 const suffix = randomBytes(4).toString("hex");
 const role = "s2_owner_" + suffix, password = randomBytes(18).toString("hex");
 const databases = [], pools = [], children = [];
 const environment = {};
 const open = url => { const pool = new pg.Pool({ connectionString: url, max: 6 }); pool.on("error", () => undefined); pools.push(pool); return pool; };
 const database = async name => {
  const db = name + "_" + suffix;
  await admin.query(`CREATE DATABASE ${db} OWNER ${role}`);
  databases.push(db);
  const url = new URL(adminUrl);
  url.username = role;
  url.password = password;
  url.pathname = "/" + db;
  return { name: db, url: url.href };
 };
 let watch = null;
 try {
  await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
  Object.assign(environment, (await admin.query("SELECT current_setting('server_version') AS server, (SELECT rolsuper FROM pg_roles WHERE rolname = $1) AS owner_superuser", [role])).rows[0]);
  environment.clientTools = (await exec(path.join(clientTools.bin, "pg_dump"), ["--version"], { env: clientTools.env })).stdout.trim();
  environment.node = process.version;
  environment.cpu = { model: os.cpus()[0]?.model ?? "unknown", count: os.cpus().length, arch: os.arch() };
  const live = await database("s2_live");
  watch = await watchFixture(live.url);
  const w = watch;
  const liveApp = w.env.DATABASE_URL;
  const schema = new URL(liveApp).searchParams.get("options").replace("-c search_path=", "");
  const app = target => inSchema(target.url, schema);
  const pair = (source, target) => ({ SCOAT_SOURCE_DATABASE_URL: source, SCOAT_TARGET_DATABASE_URL: target });
  const secrets = [password];
  const outbound = async () => ({ seller: w.state.hits, mail: (await w.deliveries()).length, requests: (await w.requests()).length });
  const mailTo = async address => (await w.deliveries()).filter(item => JSON.stringify(item.message?.to ?? "").includes(address));
  const alertsOf = async pool => Object.fromEntries((await pool.query("SELECT watch, id, state, provider_key, md5(message::text) AS payload, deadline::text AS deadline, last_error FROM watch_alerts ORDER BY id")).rows.map(row => [row.watch, row]));
  const serverEnv = url => ({ PORT: "0", DATABASE_URL: url, SCOAT_AUTH_CONFIG: w.f.root + "/auth.json", SCOAT_CONTROL_CONFIG: w.f.root + "/control.json", SCOAT_KNOWLEDGE_DIRECTORY: w.f.root + "/releases", SCOAT_TLS_KEY: w.f.root + "/key.pem", SCOAT_TLS_CERT: w.f.root + "/cert.pem", SCOAT_WATCH_CONFIG: w.root + "/watch.json", SCOAT_FIXTURE_SELLER_PORT: String(w.sellerPort), NODE_EXTRA_CA_CERTS: w.env.NODE_EXTRA_CA_CERTS });
  const sendOf = (seeded, alert) => ({ account: seeded.account, incarnation: seeded.incarnation, watch: seeded.watch, alert });
  const lose = async (seeded, day) => {
   const checked = await w.watches().check({ account: seeded.account, incarnation: seeded.incarnation, watch: seeded.watch, day });
   assert.ok(checked.alert, JSON.stringify(checked));
   await assert.rejects(w.watches(async point => { if (point === "submitted") throw new Error("SYNTHETIC lost provider response"); }).send(sendOf(seeded, checked.alert)), /lost provider response/);
   return checked.alert;
  };
  environment.role = { superuser: (await w.pool.query("SELECT current_setting('is_superuser') AS value")).rows[0].value };

  const r = await w.seedWatch({ address: "r-" + suffix + "@example.test" });
  const subjectX = "recovery-subject-x-" + suffix;
  const loginX = await w.f.login("host-one", subjectX);
  const principalX = await w.f.authenticate(loginX.token);
  const x = await w.seedWatch({ account: principalX.agent.account, incarnation: principalX.agent.incarnation, address: "erased-x-" + suffix + "@example.test" });
  const b0 = path.join(root, "b0-pre-alert.dump");
  let k1;
  await gate("R2 setup: pre-alert, pre-erasure backup B0, then accepted alert K1 and browser erasure of account X on live", async () => {
   await rawTool("pg_dump", ["--format=custom", "--file=" + b0], live.url);
   w.state.pence = 5000;
   const checked = await w.watches().check({ account: r.account, incarnation: r.incarnation, watch: r.watch, day: "2027-03-01" });
   assert.ok(checked.alert);
   assert.equal(await w.watches().send(sendOf(r, checked.alert)), "accepted");
   k1 = (await alertsOf(w.pool))[r.watch].provider_key;
   await w.f.login("host-one", subjectX);
   const erased = await confirm(w.f, w.f.issuer + "/account/erase", "/account/erase", "erase");
   assert.equal(erased.result.status, 200, await erased.result.clone().text());
   await assert.rejects(w.f.authenticate(loginX.token), error => error instanceof InvalidCredential);
   const remaining = (await w.pool.query("SELECT (SELECT count(*) FROM watches WHERE account=$1)::integer AS watches, (SELECT count(*) FROM watch_recipients WHERE account=$1)::integer AS recipients, (SELECT count(*) FROM hunt_accounts WHERE account=$1 AND NOT erased)::integer AS active", [x.account])).rows[0];
   assert.deepEqual(remaining, { watches: 0, recipients: 0, active: 0 });
   return { k1, deliveriesK1: (await w.deliveries()).filter(item => item.key === k1).length, erasedAccount: "X", remaining };
  });

  const t0 = await database("s2_t0");
  await gate("R2 pre-seal backup restore: admit refuses archive-not-sealed; server and workers refuse; CLI restore refuses an unsealed source before tools; zero outbound", async () => {
   await rawTool("pg_restore", ["--exit-on-error", b0], t0.url);
   const before = await digest(t0.url), sent = await outbound();
   const admitted = await cli(["admit"], pair(liveApp, app(t0)), secrets);
   assert.equal(admitted.code, 78);
   assert.equal(admitted.refusal.reason, "archive-not-sealed");
   const exits = [];
   for (const [entry, env] of [[new URL("../dist/server.js", import.meta.url), serverEnv(app(t0))], [new URL("./watch-worker.mjs", import.meta.url), { ...w.env, DATABASE_URL: app(t0) }], [new URL("../dist/worker.js", import.meta.url), { DATABASE_URL: app(t0), SCOAT_WATCH_CONFIG: w.root + "/watch.json" }]]) {
    const result = await launchRefused(entry, env);
    assert.equal(result.code, 78, result.stderr);
    assert.match(result.stderr, /"reason":"identity-mismatch"/);
    exits.push(result.code);
   }
   const spare = await database("s2_spare");
   const archive = path.join(root, "unsealed-source.dump");
   const restored = await cli(["restore", "--archive", archive], pair(liveApp, app(spare)), secrets);
   assert.equal(restored.code, 78);
   assert.equal(restored.refusal.reason, "source-not-sealed");
   await assert.rejects(access(archive));
   assert.deepEqual((await digest(spare.url)).schemas, ["public"]);
   assert.deepEqual(await digest(t0.url), before);
   assert.deepEqual(await outbound(), sent);
   return { admit: admitted.refusal, exits, restore: restored.refusal, outbound: sent };
  });

  await gate("R2 original-shape reproduction: base 6ec8b75 worker on the same pre-seal restore sends a second identity and mails the erased account", async () => {
   let base, baseLabel;
   try {
    ({ path: base, label: baseLabel } = await baseArtifact(checkout, root, "6ec8b75"));
   } catch (error) {
    throw new Blocked("Base artifact unavailable: " + String(error?.message ?? error).slice(0, 600));
   }
   const before = { r: (await mailTo(r.address)).map(item => item.key), x: (await mailTo(x.address)).length };
   const worker = await launchReady(new URL("file://" + path.join(base, "scripts/watch-worker.mjs")), { ...w.env, DATABASE_URL: app(t0) });
   children.push(worker.child);
   const { WatchQueue: BaseQueue } = await import(path.join(base, "dist/queue/index.js"));
   const producer = await BaseQueue.open(app(t0), "producer");
   try {
    await producer.triggerPlan();
    await until("base deliveries", async () => (await mailTo(r.address)).length > before.r.length && (await mailTo(x.address)).length > before.x);
   } finally {
    await producer.stop();
    await stop(worker.child);
   }
   const afterR = (await mailTo(r.address)).map(item => item.key);
   const second = afterR.filter(key => key !== k1);
   assert.ok(afterR.includes(k1) && second.length >= 1);
   return { label: "original unsafe restore on base artifact 6ec8b75 against a disposable pre-seal restore", artifact: baseLabel, liveKey: k1, baseKeys: second, deliveriesToR: afterR.length, deliveriesToErasedX: (await mailTo(x.address)).length - before.x };
  });

  w.state.pence = 5000;
  const b = await w.seedWatch({ address: "b-" + suffix + "@example.test" });
  const c = await w.seedWatch({ address: "c-" + suffix + "@example.test" });
  const d = await w.seedWatch({ address: "d-" + suffix + "@example.test" });
  let snapshot;
  await gate("R3 setup: accepted, ambiguous submitting, pending and past-deadline ambiguous alerts with queued sends", async () => {
   await lose(b, "2027-03-01");
   const checkedC = await w.watches().check({ account: c.account, incarnation: c.incarnation, watch: c.watch, day: "2027-03-01" });
   assert.ok(checkedC.alert);
   const alertD = await lose(d, "2027-03-01");
   await w.pool.query("UPDATE watch_alerts SET deadline=clock_timestamp()-interval '1 minute' WHERE id=$1", [alertD]);
   await w.pool.query("INSERT INTO oauth_artifacts(model,id,payload,expires_at) VALUES('Session',$1,'{}',now()-interval '1 hour')", [randomUUID()]);
   await w.pool.query("INSERT INTO oauth_browser_flows(state,data,expires_at) VALUES($1,'{}',now()-interval '1 hour')", [randomUUID()]);
   await w.pool.query("INSERT INTO erase_status(digest,operation,expires_at) VALUES($1,$2,now()-interval '1 hour')", [randomUUID(), randomUUID()]);
   snapshot = await alertsOf(w.pool);
   assert.deepEqual([r, b, c, d].map(item => snapshot[item.watch].state), ["accepted", "submitting", "pending", "submitting"]);
   const queued = (await w.pool.query(`SELECT count(*)::integer AS count FROM ${w.queueSchema}.job WHERE name LIKE '%send%' AND state='created'`)).rows[0].count;
   assert.ok(queued >= 4);
   const requests = await w.requests();
   return { states: Object.fromEntries([["accepted", r], ["submitting", b], ["pending", c], ["pastDeadline", d]].map(([label, item]) => [label, { key: snapshot[item.watch].provider_key, requests: requests.filter(request => request.key === snapshot[item.watch].provider_key).length }])), queuedSends: queued, syntheticDeadline: "labeled A4: deadline moved one minute into the past" };
  });

  const t1 = await database("s2_t1");
  await gate("R1 full restore of the admitted source with open alerts and queued sends refuses server and workers before maintenance and queue effects", async () => {
   const dump = path.join(root, "admitted-source.dump");
   await rawTool("pg_dump", ["--format=custom", "--file=" + dump], live.url);
   await rawTool("pg_restore", ["--exit-on-error", dump], t1.url);
   const before = await digest(t1.url), sent = await outbound();
   const exits = [];
   for (const [entry, env] of [[new URL("../dist/server.js", import.meta.url), serverEnv(app(t1))], [new URL("./watch-worker.mjs", import.meta.url), { ...w.env, DATABASE_URL: app(t1) }], [new URL("../dist/worker.js", import.meta.url), { DATABASE_URL: app(t1), SCOAT_WATCH_CONFIG: w.root + "/watch.json" }]]) {
    const result = await launchRefused(entry, env);
    assert.equal(result.code, 78, result.stderr);
    exits.push(result.code);
   }
   for (const table of ["oauth_artifacts", "oauth_browser_flows", "erase_status"]) assert.ok(before.rows[schema + "." + table].count > 0, table);
   const after = await digest(t1.url);
   assert.deepEqual(after, before);
   assert.deepEqual(await outbound(), sent);
   const same = await cli(["restore", "--archive", path.join(root, "same.dump")], pair(liveApp, liveApp), secrets);
   assert.equal(same.refusal?.reason, "same-database");
   return { exits, queueJobs: before.rows[w.queueSchema + ".job"], maintenanceRows: Object.fromEntries(["oauth_artifacts", "oauth_browser_flows", "erase_status", "hunt_accounts"].map(table => [table, before.rows[schema + "." + table]])), outbound: sent, sameDatabase: same.refusal };
  });

  await gate("R4b failing next migration leaves the target schema and journal unchanged and the source unconsumed; unseal resumes the source", async () => {
   const sealed = await cli(["seal"], { DATABASE_URL: liveApp }, secrets);
   assert.equal(sealed.code, 0, sealed.stderr);
   const target = await database("s2_tq");
   const restored = await cli(["restore", "--archive", path.join(root, "tq.dump")], pair(liveApp, app(target)), secrets);
   assert.equal(restored.code, 0, restored.stderr);
   const failing = await migrationsWith("migrations-failing", "CREATE TABLE recovery_probe (id integer PRIMARY KEY);\n--> statement-breakpoint\nSELECT 1/0;\n");
   const before = await digest(target.url);
   const source = open(liveApp), targetPool = open(app(target));
   let refusal;
   await assert.rejects(admitTarget({ source, target: targetPool, migrations: failing }), error => { refusal = error; return refusedWith("migration-failed")(error); });
   assert.equal(refusal.detail.sqlstate, "22012");
   const after = await digest(target.url);
   assert.deepEqual(after, before);
   assert.ok(after.schemas.includes("drizzle"), "the fixture source records its installed journal");
   const status = await cli(["status"], { DATABASE_URL: liveApp }, secrets);
   assert.deepEqual(status.out, { command: "status", state: "sealed", sealId: sealed.out.sealId, consumedBy: null });
   const reopened = await cli(["unseal", "--seal", sealed.out.sealId], { DATABASE_URL: liveApp }, secrets);
   assert.deepEqual(reopened.out, { command: "unseal", result: "unsealed" });
   assert.equal((await inspect(w.pool)).kind, "admitted");
   await retryTransaction(w.pool, client => client.query("UPDATE watches SET status=status WHERE id=$1", [c.watch]));
   await assert.rejects(admitTarget({ source, target: targetPool, migrations }), refusedWith("source-not-sealed"));
   assert.deepEqual(await digest(target.url), before);
   return { refusal: { reason: refusal.reason, ...refusal.detail }, targetDigestUnchanged: true, journalSchemaPresent: after.schemas.includes("drizzle"), sourceAfterFailure: status.out, unseal: reopened.out, staleTargetAfterUnseal: "source-not-sealed" };
  });

  let sealId, t2, t3, r2, r3;
  await gate("Sealed handoff: seal, CLI restore into two fresh targets; populated target and reused archive refuse before tools", async () => {
   const sealed = await cli(["seal"], { DATABASE_URL: liveApp }, secrets);
   assert.equal(sealed.code, 0, sealed.stderr);
   sealId = sealed.out.sealId;
   const populated = await cli(["restore", "--archive", path.join(root, "populated.dump")], pair(liveApp, app(t1)), secrets);
   assert.equal(populated.refusal?.reason, "target-not-fresh");
   await assert.rejects(access(path.join(root, "populated.dump")));
   t2 = await database("s2_t2");
   t3 = await database("s2_t3");
   r2 = await cli(["restore", "--archive", path.join(root, "t2.dump")], pair(liveApp, app(t2)), secrets);
   r3 = await cli(["restore", "--archive", path.join(root, "t3.dump")], pair(liveApp, app(t3)), secrets);
   assert.equal(r2.code, 0, r2.stderr);
   assert.equal(r3.code, 0, r3.stderr);
   assert.equal(r2.out.sealId, sealId);
   assert.notEqual(r2.out.locator, r3.out.locator);
   const t4 = await database("s2_t4");
   const reused = await cli(["restore", "--archive", path.join(root, "t2.dump")], pair(liveApp, app(t4)), secrets);
   assert.equal(reused.refusal?.reason, "archive-exists");
   const t2Digest = await digest(t2.url);
   assert.ok(t2Digest.schemas.includes(schema) && t2Digest.schemas.includes(w.queueSchema));
   return { sealId, t2: r2.out, t3: r3.out, populated: populated.refusal, reused: reused.refusal, schemas: t2Digest.schemas };
  });

  await gate("R4 crash between source CAS and target bind; unseal refuses while the designated target is unadmitted; second target refuses; retry admits; rerun is already-admitted; copy of the admitted target refuses", async () => {
   const crash = fork(new URL("./recovery-crash.mjs", import.meta.url), [], { execArgv: [], silent: true, cwd: checkout, env: { ...process.env, ...pair(liveApp, app(t2)), SCOAT_CRASH_POINT: "consumed" } });
   children.push(crash);
   crash.stdout.resume();
   crash.stderr.resume();
   const paused = await new Promise((resolve, reject) => { crash.once("message", resolve); crash.once("exit", code => reject(new Error("crash helper exited " + code))); });
   assert.deepEqual(paused, { paused: "consumed" });
   const killed = await new Promise(resolve => { crash.once("exit", (code, signal) => resolve(signal)); crash.kill("SIGKILL"); });
   const consumed = await cli(["status"], { DATABASE_URL: liveApp }, secrets);
   assert.deepEqual(consumed.out, { command: "status", state: "sealed", sealId, consumedBy: r2.out.locator });
   const t2Pool = open(app(t2));
   assert.deepEqual(await inspect(t2Pool), { kind: "unadmitted", reason: "identity-mismatch" });
   const strandedUnseal = await cli(["unseal", "--seal", sealId], { DATABASE_URL: liveApp }, secrets);
   assert.equal(strandedUnseal.code, 78);
   assert.equal(strandedUnseal.refusal.reason, "consumed");
   const t3Before = await digest(t3.url);
   const second = await cli(["admit"], pair(liveApp, app(t3)), secrets);
   assert.equal(second.refusal?.reason, "consumed");
   assert.deepEqual(await digest(t3.url), t3Before);
   const retried = await cli(["admit"], pair(liveApp, app(t2)), secrets);
   assert.deepEqual(retried.out, { command: "admit", result: "admitted" });
   const rerun = await cli(["admit"], pair(liveApp, app(t2)), secrets);
   assert.deepEqual(rerun.out, { command: "admit", result: "already-admitted" });
   assert.equal((await inspect(t2Pool)).kind, "admitted");
   const afterUnseal = await cli(["unseal", "--seal", sealId], { DATABASE_URL: liveApp }, secrets);
   assert.equal(afterUnseal.refusal?.reason, "consumed");
   const clone = "s2_t2copy_" + suffix;
   await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [t2.name]);
   await admin.query(`CREATE DATABASE ${clone} OWNER ${role} TEMPLATE ${t2.name}`);
   databases.push(clone);
   const cloneUrl = new URL(t2.url);
   cloneUrl.pathname = "/" + clone;
   const copied = await cli(["admit"], pair(liveApp, inSchema(cloneUrl.href, schema)), secrets);
   assert.equal(copied.refusal?.reason, "archive-not-sealed");
   const liveStatus = await fetch(w.f.issuer + "/healthz");
   assert.equal(liveStatus.status, 503);
   return { killedWith: killed, consumedBy: consumed.out.consumedBy, strandedUnseal: strandedUnseal.refusal, secondTarget: second.refusal, retry: retried.out, rerun: rerun.out, afterAdmitUnseal: afterUnseal.refusal, adminCopy: copied.refusal, liveHealth: liveStatus.status };
  });

  await gate("R3 replay on the admitted target: real worker and queue; accepted not re-requested; ambiguous retried with identical key, payload and deadline; pending once; expired unconfirmed; erased account absent and old token denied", async () => {
   w.state.pence = 6620;
   const t2Pool = open(app(t2));
   const before = { requests: await w.requests(), deliveries: await w.deliveries(), x: (await mailTo(x.address)).length };
   const restored = await alertsOf(t2Pool);
   for (const item of [r, b, c, d]) for (const field of ["id", "state", "provider_key", "payload", "deadline"]) assert.equal(restored[item.watch][field], snapshot[item.watch][field]);
   const worker = await launchReady(new URL("./watch-worker.mjs", import.meta.url), { ...w.env, DATABASE_URL: app(t2) });
   children.push(worker.child);
   const admitted = await admit(t2Pool, "server");
   const producer = await WatchQueue.open(admitted, app(t2), "producer");
   let settled;
   try {
    await producer.triggerPlan();
    settled = await until("replayed alerts", async () => { const now = await alertsOf(t2Pool); return now[b.watch].state === "accepted" && now[c.watch].state === "accepted" && now[d.watch].state === "unconfirmed" ? now : null; });
    await until("queue drain", async () => (await t2Pool.query(`SELECT count(*)::integer AS count FROM ${w.queueSchema}.job WHERE state IN ('created','retry','active') AND name NOT LIKE '%daily%' AND name NOT LIKE '%check%'`)).rows[0].count === 0);
   } finally {
    await producer.stop();
    await stop(worker.child);
   }
   const requests = await w.requests(), deliveries = await w.deliveries();
   const keyed = (list, key) => list.filter(item => item.key === key);
   const key = item => snapshot[item.watch].provider_key;
   assert.equal(keyed(requests, key(r)).length, keyed(before.requests, key(r)).length);
   assert.equal(keyed(deliveries, key(r)).length, 1);
   assert.ok(keyed(requests, key(b)).length > keyed(before.requests, key(b)).length);
   assert.equal(new Set(keyed(requests, key(b)).map(item => item.digest)).size, 1);
   assert.equal(keyed(deliveries, key(b)).length, 1);
   assert.equal(keyed(deliveries, key(c)).length, 1);
   assert.equal(keyed(requests, key(d)).length, keyed(before.requests, key(d)).length);
   assert.equal(settled[d.watch].last_error, "retry-horizon");
   for (const item of [b, c, d]) for (const field of ["provider_key", "payload", "deadline"]) assert.equal(settled[item.watch][field], snapshot[item.watch][field]);
   const erased = (await t2Pool.query(`SELECT (SELECT count(*) FROM watches WHERE account=$1)::integer AS watches, (SELECT count(*) FROM watch_alerts WHERE account=$1)::integer AS alerts, (SELECT count(*) FROM watch_recipients WHERE account=$1)::integer AS recipients, (SELECT count(*) FROM hunt_accounts WHERE account=$1 AND NOT erased)::integer AS active, (SELECT count(*) FROM ${w.queueSchema}.job WHERE data->>'account'=$1)::integer AS jobs`, [x.account])).rows[0];
   assert.deepEqual(erased, { watches: 0, alerts: 0, recipients: 0, active: 0, jobs: 0 });
   assert.equal((await mailTo(x.address)).length, before.x);
   const issuer = await createIssuer(JSON.parse(await readFile(w.f.root + "/auth.json", "utf8")), t2Pool);
   await assert.rejects(issuer.authenticate({ headers: { authorization: "Bearer " + loginX.token } }), error => error instanceof InvalidCredential);
   return {
    accepted: { key: key(r), newRequests: keyed(requests, key(r)).length - keyed(before.requests, key(r)).length, deliveries: keyed(deliveries, key(r)).length },
    ambiguous: { key: key(b), newRequests: keyed(requests, key(b)).length - keyed(before.requests, key(b)).length, payloadDigests: 1, deliveries: keyed(deliveries, key(b)).length, state: settled[b.watch].state },
    pending: { key: key(c), deliveries: keyed(deliveries, key(c)).length, state: settled[c.watch].state },
    expired: { key: key(d), newRequests: 0, state: settled[d.watch].state, reason: settled[d.watch].last_error },
    erased,
    oldToken: "InvalidCredential",
   };
  });

  const pristine = async tag => {
   const source = await database("s2_" + tag);
   await exec(process.execPath, [path.join(checkout, "scripts/database.mjs"), "migrate"], { cwd: checkout, env: { ...process.env, DATABASE_URL: source.url } });
   const pool = open(source.url);
   await retryTransaction(pool, client => client.query("INSERT INTO hunt_accounts(account,incarnation) VALUES($1,$2)", [randomUUID(), randomUUID()]));
   assert.equal((await inspect(pool)).kind, "admitted");
   return { ...source, pool };
  };
  const sealAndRestore = async (source, tag) => {
   const sealed = await cli(["seal"], { DATABASE_URL: source.url }, secrets);
   assert.equal(sealed.code, 0, sealed.stderr);
   const target = await database("s2_" + tag);
   const restored = await cli(["restore", "--archive", path.join(root, tag + ".dump")], pair(source.url, target.url), secrets);
   assert.equal(restored.code, 0, restored.stderr);
   return { ...target, pool: open(target.url), sealId: sealed.out.sealId, locator: restored.out.locator };
  };

  let pairP;
  await gate("R4 unseal before the source CAS makes the delayed CAS fail; a CAS carrying the old seal fails after reseal", async () => {
   pairP = await pristine("p_src");
   const first = await sealAndRestore(pairP, "p_ta");
   const hold = barrier();
   const pending = admitTarget({ source: pairP.pool, target: first.pool, migrations, pause: hold.at("migrated") });
   await hold.reached;
   assert.equal(await unseal(pairP.pool, first.sealId), "unsealed");
   hold.release();
   await assert.rejects(pending, refusedWith("source-not-sealed"));
   assert.equal((await inspect(pairP.pool)).kind, "admitted");
   assert.deepEqual(await inspect(first.pool), { kind: "unadmitted", reason: "identity-mismatch" });
   const second = await sealAndRestore(pairP, "p_tb");
   const stale = await locateTarget(first.pool);
   assert.equal(stale.kind, "quarantined");
   await assert.rejects(consumeSource(pairP.pool, stale.target), refusedWith("seal-mismatch"));
   await assert.rejects(admitTarget({ source: pairP.pool, target: first.pool, migrations }), refusedWith("seal-mismatch"));
   const source = await inspect(pairP.pool);
   assert.deepEqual([source.kind, source.sealId, source.consumedBy], ["sealed", second.sealId, null]);
   pairP.second = second;
   return { delayedCas: "source-not-sealed", oldSealCas: "seal-mismatch", sourceAfter: { state: source.kind, consumedBy: source.consumedBy } };
  });

  await gate("R4 controlled consume/unseal overlap: with the target bind in flight, unseal refuses consumed and exactly one database becomes active", async () => {
   const target = pairP.second;
   const hold = barrier();
   const pending = admitTarget({ source: pairP.pool, target: target.pool, migrations, pause: hold.at("binding") });
   await hold.reached;
   const inFlight = await inspect(target.pool);
   assert.notEqual(inFlight.kind, "admitted");
   const source = await inspect(pairP.pool);
   assert.equal(source.consumedBy, target.locator);
   await assert.rejects(unseal(pairP.pool, target.sealId), refusedWith("consumed"));
   hold.release();
   assert.equal(await pending, "admitted");
   const final = [(await inspect(pairP.pool)).kind, (await inspect(target.pool)).kind];
   assert.deepEqual(final, ["sealed", "admitted"]);
   return { targetDuringBind: inFlight, unseal: "consumed", final };
  });

  await gate("R4 original unsafe unseal negative: reopening a consumed source because its target still looks unadmitted yields two active databases (emulation)", async () => {
   const source = await pristine("p2_src");
   const target = await sealAndRestore(source, "p2_t");
   const hold = barrier();
   const pending = admitTarget({ source: source.pool, target: target.pool, migrations, pause: hold.at("binding") });
   await hold.reached;
   const looks = await inspect(target.pool);
   assert.notEqual(looks.kind, "admitted");
   const unsafe = await source.pool.connect();
   let reopened;
   try {
    await unsafe.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await unsafe.query("SELECT pg_advisory_xact_lock(80109, hashtext(current_schema()))");
    reopened = (await unsafe.query("UPDATE scoat_lineage SET state='admitted', seal_id=NULL, consumed_by=NULL, identity=scoat_lineage_identity(pg_current_xact_id()::text::numeric % 4294967296) WHERE state='sealed' AND seal_id=$1 AND consumed_by=$2 AND identity=scoat_lineage_identity(xmin::text::numeric)", [target.sealId, target.locator])).rowCount;
    await unsafe.query("COMMIT");
   } finally { unsafe.release(); }
   hold.release();
   assert.equal(await pending, "admitted");
   const final = [(await inspect(source.pool)).kind, (await inspect(target.pool)).kind];
   assert.equal(reopened, 1);
   assert.deepEqual(final, ["admitted", "admitted"]);
   return { label: "emulated original unsafe unseal on disposable databases", targetLooked: looks, reopened, final };
  });

  await gate("R4b corrected next migration permits admission and records the artifact schema head", async () => {
   const source = await pristine("q_src");
   const failingTarget = await sealAndRestore(source, "q_fail");
   const failing = await migrationsWith("migrations-q-failing", "CREATE TABLE recovery_probe (id integer PRIMARY KEY);\n--> statement-breakpoint\nSELECT 1/0;\n");
   const journal = async pool => (await pool.query("SELECT count(*)::integer AS count, md5(string_agg(hash, ',' ORDER BY id)) AS digest FROM drizzle.__drizzle_migrations")).rows[0];
   const before = { digest: await digest(failingTarget.url), journal: await journal(failingTarget.pool) };
   await assert.rejects(admitTarget({ source: source.pool, target: failingTarget.pool, migrations: failing }), refusedWith("migration-failed"));
   assert.deepEqual({ digest: await digest(failingTarget.url), journal: await journal(failingTarget.pool) }, before);
   assert.equal((await inspect(source.pool)).consumedBy, null);
   const fixed = await migrationsWith("migrations-q-fixed", "CREATE TABLE recovery_probe (id integer PRIMARY KEY);\n");
   assert.equal(await admitTarget({ source: source.pool, target: failingTarget.pool, migrations: fixed }), "admitted");
   const after = await journal(failingTarget.pool);
   assert.equal(after.count, before.journal.count + 1);
   assert.equal((await failingTarget.pool.query("SELECT to_regclass('recovery_probe') IS NOT NULL AS present")).rows[0].present, true);
   assert.equal((await inspect(failingTarget.pool)).kind, "admitted");
   return { journalBefore: before.journal.count, journalAfter: after.count, schemaHead: "0004_lineage (artifact constant; scratch 0005 is a test-only migration)" };
  });
 } finally {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  if (watch) await watch.close().catch(error => gates.push({ name: "watch fixture cleanup", status: "FAIL", error: String(error) }));
  for (const pool of pools) await pool.end().catch(() => undefined);
  for (const db of databases) {
   await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [db]);
   await admin.query(`DROP DATABASE IF EXISTS ${db}`);
  }
  await admin.query(`DROP ROLE IF EXISTS ${role}`);
  await admin.end();
  const head = (await exec("git", ["rev-parse", "HEAD"], { cwd: checkout })).stdout.trim();
  const porcelain = (await exec("git", ["status", "--porcelain"], { cwd: checkout })).stdout;
  const receipt = {
   scope: "P09 S2 sealed-source recovery CLI and R-gates (not the P09 public story)",
   head,
   porcelain,
   trackedPatchSha256: sha((await exec("git", ["diff", "HEAD"], { cwd: checkout, maxBuffer: 1 << 26 })).stdout),
   environment,
   gates,
   retainedFromS1: ["R5 sealed running server/worker and in-place data-only reload", "R6 schema-scoped lock conflict and isolation", "R7 data-only lineage reload"].map(name => ({ name, lane: "npm run verify -- p09-lineage" })),
   forbidden: [
    { shape: "selective data-only restore of other tables excluding lineage", status: "FORBIDDEN, undetectable by row identity" },
    { shape: "snapshot or volume rollback of live with no later lineage write", status: "FORBIDDEN, undetectable" },
    { shape: "owner-role recomputation of the bind expression", status: "FORBIDDEN, copy detection is not tamper evidence" },
    { shape: "losing the designated target after source consumption", status: "SUPPORTED ONLY AS FAIL-CLOSED: the source stays sealed and is stranded" },
   ],
   untested: ["managed PostgreSQL permissions and failover", "real Resend same-key idempotency (TLS capture stand-in)", "restore under a different owner role name", "fixed two-CPU runner"],
   databases,
   role,
  };
  await writeFile(path.join(root, "receipt.json"), JSON.stringify(receipt, null, 1) + "\n");
  process.stdout.write(JSON.stringify({ receipt: path.join(root, "receipt.json"), gates: gates.map(item => item.name + ": " + item.status) }, null, 1) + "\n");
 }
});
