import assert from "node:assert/strict";
import { execFile, fork } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { withDatabase } from "./durable-database.mjs";
import { scratchDirectory } from "./scratch.mjs";
import { watchFixture } from "./watch-fixture.mjs";
import { fixture as durableFixture } from "./durable-fixture.mjs";
import { admit, begin, inspect, seal, unseal, LineageRefused } from "../dist/db/lineage.js";
import { retryTransaction } from "../dist/db/transaction.js";
import { durableSchema } from "../dist/db/schema.js";
import { maintainAccounts } from "../dist/accounts/maintenance.js";
import { WatchQueue } from "../dist/queue/index.js";

const exec = promisify(execFile);
const checkout = new URL("..", import.meta.url).pathname;
const pgBin = process.env.SCOAT_PG_BIN ?? path.join(os.homedir(), ".local/pg/root/usr/lib/postgresql/18/bin");
const pgLib = process.env.SCOAT_PG_LIB ?? path.join(os.homedir(), ".local/pg/root/usr/lib/aarch64-linux-gnu");
const root = await scratchDirectory("lineage-", path.join(os.homedir(), "tmp/scoat-delivery/p09/s1"));
const gates = [];
const bind = "scoat_lineage_identity(pg_current_xact_id()::text::numeric % 4294967296)";
const refusedWith = reason => error => error instanceof LineageRefused && error.reason === reason;

async function gate(name, run) {
 try {
  gates.push({ name, status: "PASS", detail: await run() ?? null });
 } catch (error) {
  gates.push({ name, status: "FAIL", error: String(error?.stack ?? error) });
  process.exitCode = 1;
 }
}
const tool = (name, args) => exec(path.join(pgBin, name), args, { env: { PATH: process.env.PATH, LD_LIBRARY_PATH: pgLib }, maxBuffer: 1 << 26 });
const inSchema = (url, schema) => { const value = new URL(url); value.searchParams.set("options", "-c search_path=" + schema); return value.href; };
const plain = url => { const value = new URL(url); value.search = ""; return value.href; };

function launch(entry, env, timeout = 30000) {
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

async function digest(url) {
 const pool = new pg.Pool({ connectionString: plain(url), max: 1 });
 try {
  const schemas = (await pool.query("SELECT array_agg(nspname::text ORDER BY nspname) AS names FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'")).rows[0].names;
  const tables = (await pool.query("SELECT schemaname::text AS schema, tablename::text AS name FROM pg_tables WHERE schemaname = ANY($1) ORDER BY 1, 2", [schemas])).rows;
  const rows = {};
  for (const table of tables) {
   const qualified = `"${table.schema}"."${table.name}"`;
   rows[table.schema + "." + table.name] = (await pool.query(`SELECT count(*)::integer AS count, coalesce(md5(string_agg(to_jsonb(x)::text, '|' ORDER BY to_jsonb(x)::text)), '') AS digest FROM ${qualified} x`)).rows[0];
  }
  const catalog = (await pool.query("SELECT count(*)::integer AS objects, md5(string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || coalesce((SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped), ''), '|' ORDER BY n.nspname, c.relname)) AS digest FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ANY($1)", [schemas])).rows[0];
  const functions = (await pool.query("SELECT md5(string_agg(n.nspname || '.' || p.proname || ':' || md5(p.prosrc), '|' ORDER BY n.nspname, p.proname)) AS digest FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ANY($1)", [schemas])).rows[0].digest;
  return { schemas, rows, catalog, functions };
 } finally { await pool.end(); }
}

async function waiterOn(pool, blocker) {
 for (let attempt = 0; attempt < 200; attempt++) {
  const waiting = await pool.query("SELECT pid FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid))", [blocker]);
  if (waiting.rowCount) return waiting.rows[0].pid;
  await new Promise(resolve => setTimeout(resolve, 50));
 }
 throw new Error("No backend waited on the lineage holder");
}

async function lineageRow(pool) {
 const row = (await pool.query("SELECT state, seal_id, consumed_by, identity, scoat_lineage_identity(xmin::text::numeric) AS current FROM scoat_lineage")).rows[0];
 const names = ["systemIdentifier", "timeline", "databaseOid", "tableOid", "rowXmin"];
 const stored = row.identity.split(":"), current = row.current.split(":");
 return { ...row, differing: names.filter((_, index) => stored[index] !== current[index]) };
}

await withDatabase(async adminUrl => {
 const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
 const suffix = randomBytes(4).toString("hex");
 const role = "s1_owner_" + suffix, password = randomBytes(18).toString("hex");
 const databases = [];
 const pools = [];
 const open = url => { const pool = new pg.Pool({ connectionString: url, max: 6 }); pools.push(pool); return pool; };
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
 const environment = {};
 let watch = null;
 try {
  await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
  Object.assign(environment, (await admin.query("SELECT current_setting('server_version') AS server, (SELECT rolsuper FROM pg_roles WHERE rolname = $1) AS owner_superuser", [role])).rows[0]);
  environment.clientTools = (await tool("pg_dump", ["--version"])).stdout.trim();
  const live = await database("s1_live");
  watch = await watchFixture(live.url);
  const w = watch;
  const schema = new URL(w.f.databaseUrl).searchParams.get("options").replace("-c search_path=", "");
  environment.role = { superuser: (await w.pool.query("SELECT current_setting('is_superuser') AS value")).rows[0].value };
  let seeded;
  await gate("source populated through admitted owners (accounts, hunt, watch, alert, queue, maintenance rows)", async () => {
   assert.equal((await inspect(w.pool)).kind, "admitted");
   seeded = await w.seedWatch();
   w.state.pence = 5000;
   const checked = await w.watches().check({ account: seeded.account, incarnation: seeded.incarnation, watch: seeded.watch, day: "2027-03-01" });
   assert.ok(checked.alert, JSON.stringify(checked));
   await retryTransaction(w.pool, client => w.producer.check(client, { account: seeded.account, incarnation: seeded.incarnation, watch: seeded.watch, day: "2027-03-02" }));
   const hunts = await durableFixture(w.f.databaseUrl);
   try { await hunts.start(); } finally { await hunts.store.close(); }
   await w.pool.query("INSERT INTO oauth_artifacts(model,id,payload,expires_at) VALUES('Session',$1,'{}',now()-interval '1 hour')", [randomUUID()]);
   await w.pool.query("INSERT INTO oauth_browser_flows(state,data,expires_at) VALUES($1,'{}',now()-interval '1 hour')", [randomUUID()]);
   await w.pool.query("INSERT INTO erase_status(digest,operation,expires_at) VALUES($1,$2,now()-interval '1 hour')", [randomUUID(), randomUUID()]);
   await w.pool.query("INSERT INTO account_suppression(account,incarnation,subject_digest,key_version,erased_at,purge_after) VALUES($1,$2,$3,'fixture',now()-interval '40 days',now()-interval '1 day')", [randomUUID(), randomUUID(), randomUUID()]);
   const counts = (await w.pool.query(`SELECT (SELECT count(*) FROM hunt_accounts)::integer AS accounts, (SELECT count(*) FROM durable_hunts)::integer AS hunts, (SELECT count(*) FROM watches)::integer AS watches, (SELECT count(*) FROM watch_alerts)::integer AS alerts, (SELECT count(*) FROM ${w.queueSchema}.job)::integer AS jobs, (SELECT count(*) FROM oauth_artifacts WHERE expires_at<now())::integer AS expired_artifacts`)).rows[0];
   for (const value of Object.values(counts)) assert.ok(value > 0);
   return { schema, queueSchema: w.queueSchema, counts };
  });

  const dump = path.join(root, "live.dump");
  const copy = await database("s1_copy");
  const copyApp = inSchema(copy.url, schema);
  const serverEnv = url => ({ PORT: "0", DATABASE_URL: url, SCOAT_AUTH_CONFIG: w.f.root + "/auth.json", SCOAT_CONTROL_CONFIG: w.f.root + "/control.json", SCOAT_KNOWLEDGE_DIRECTORY: w.f.root + "/releases", SCOAT_TLS_KEY: w.f.root + "/key.pem", SCOAT_TLS_CERT: w.f.root + "/cert.pem", SCOAT_WATCH_CONFIG: w.root + "/watch.json", SCOAT_FIXTURE_SELLER_PORT: String(w.sellerPort), NODE_EXTRA_CA_CERTS: w.env.NODE_EXTRA_CA_CERTS });
  await gate("R1 full restore of an admitted source refuses server and workers before DDL, maintenance, queue or outbound work", async () => {
   await tool("pg_dump", ["--format=custom", "--file=" + dump, "--dbname=" + plain(live.url)]);
   await tool("pg_restore", ["--exit-on-error", "--dbname=" + plain(copy.url), dump]);
   const before = await digest(copy.url);
   const outbound = { seller: w.state.hits, mail: (await w.deliveries()).length, requests: (await w.requests()).length };
   const server = await launch(new URL("../dist/server.js", import.meta.url), serverEnv(copyApp));
   const fixtureWorker = await launch(new URL("./watch-worker.mjs", import.meta.url), { ...w.env, DATABASE_URL: copyApp });
   const productionWorker = await launch(new URL("../dist/worker.js", import.meta.url), { DATABASE_URL: copyApp, SCOAT_WATCH_CONFIG: w.root + "/watch.json" });
   for (const result of [server, fixtureWorker, productionWorker]) {
    assert.equal(result.code, 78, result.stderr);
    assert.match(result.stderr, /"event":"lineage_refused","reason":"identity-mismatch"/);
   }
   const copyPool = open(copyApp);
   await assert.rejects(maintainAccounts(copyPool), refusedWith("identity-mismatch"));
   await assert.rejects(admit(copyPool, "worker"), refusedWith("identity-mismatch"));
   const after = await digest(copy.url);
   assert.deepEqual(after, before);
   assert.deepEqual({ seller: w.state.hits, mail: (await w.deliveries()).length, requests: (await w.requests()).length }, outbound);
   assert.equal((await inspect(w.pool)).kind, "admitted");
   const differing = (await lineageRow(copyPool)).differing;
   return { exits: [server.code, fixtureWorker.code, productionWorker.code], differing, tables: Object.keys(before.rows).length, catalogObjects: before.catalog.objects, outbound };
  });

  await gate("R1 original-shape negative: the base unfenced maintenance write mutates the restored copy", async () => {
   const copyPool = open(copyApp);
   const before = await digest(copy.url);
   const removed = await copyPool.query("DELETE FROM oauth_artifacts WHERE ctid IN (SELECT ctid FROM oauth_artifacts WHERE expires_at<now() ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED)", [100]);
   assert.ok(removed.rowCount > 0);
   assert.notDeepEqual(await digest(copy.url), before);
   return { label: "emulated base shape on a disposable copy", deleted: removed.rowCount };
  });

  await gate("R5 running server and worker revalidate per request and per transaction while sealed, then after unseal", async () => {
   const worker = await w.startWorker();
   const exit = new Promise(resolve => worker.process.once("exit", code => resolve(code)));
   for (let attempt = 0; ; attempt++) {
    const pending = (await w.pool.query(`SELECT count(*)::integer AS count FROM ${w.queueSchema}.job WHERE state IN ('created','retry','active') AND name <> 'watch-daily'`)).rows[0].count;
    if (pending === 0) break;
    if (attempt > 200) throw new Error("Pre-existing jobs never drained");
    await new Promise(resolve => setTimeout(resolve, 100));
   }
   const status = async () => ({ health: (await fetch(w.f.issuer + "/healthz")).status, mcp: (await fetch(w.f.issuer + "/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" })).status, discovery: (await fetch(w.f.issuer + "/.well-known/openid-configuration")).status });
   const before = await status();
   assert.deepEqual(before, { health: 200, mcp: 401, discovery: 200 });
   const { sealId } = await seal(w.pool);
   assert.equal(worker.process.exitCode, null);
   const outbound = { seller: w.state.hits, mail: (await w.deliveries()).length };
   const sealed = await status();
   assert.deepEqual(sealed, { health: 503, mcp: 503, discovery: 503 });
   const body = await (await fetch(w.f.issuer + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
   assert.deepEqual(body, { error: "service_unavailable", lineage: "sealed" });
   await assert.rejects(retryTransaction(w.pool, client => client.query("UPDATE watches SET status=status")), refusedWith("sealed"));
   await w.producer.triggerPlan();
   const code = await Promise.race([exit, new Promise((_, reject) => setTimeout(() => reject(new Error("Worker kept running while sealed")), 20000))]);
   assert.equal(code, 78);
   assert.deepEqual({ seller: w.state.hits, mail: (await w.deliveries()).length }, outbound);
   assert.equal(await unseal(w.pool, sealId), "unsealed");
   assert.deepEqual(await status(), before);
   return { before, sealed, workerExit: code };
  });

  await gate("R5/R7 data-only lineage reload under a running server is caught only by row xmin and refuses requests and transactions", async () => {
   const lineageDump = path.join(root, "lineage.dump");
   await tool("pg_dump", ["--format=custom", "--data-only", "--table=" + schema + ".scoat_lineage", "--file=" + lineageDump, "--dbname=" + plain(live.url)]);
   await w.pool.query("TRUNCATE scoat_lineage");
   await tool("pg_restore", ["--data-only", "--exit-on-error", "--dbname=" + plain(live.url), lineageDump]);
   const row = await lineageRow(w.pool);
   assert.deepEqual(row.differing, ["rowXmin"]);
   assert.equal(row.state, "admitted");
   assert.equal((await fetch(w.f.issuer + "/healthz")).status, 503);
   const refused = await fetch(w.f.issuer + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
   assert.equal(refused.status, 503);
   assert.deepEqual(await refused.json(), { error: "service_unavailable", lineage: "identity-mismatch" });
   await assert.rejects(retryTransaction(w.pool, client => client.query("UPDATE watches SET status=status")), refusedWith("identity-mismatch"));
   return { differing: row.differing, originalShape: "an identity without the row xmin would match this reload and admit it" };
  });

  const fence = await database("s1_fence");
  const control = open(fence.url);
  const schemaA = "fence_a_" + suffix, schemaB = "fence_b_" + suffix;
  await control.query(`CREATE SCHEMA ${schemaA}; CREATE SCHEMA ${schemaB}`);
  const poolA = open(inSchema(fence.url, schemaA)), poolB = open(inSchema(fence.url, schemaB));
  await poolA.query(await durableSchema());
  await poolB.query(await durableSchema());
  let firstSeal;
  await gate("R6 seal waits on a demonstrated PostgreSQL lock conflict, later writes refuse, schema B is not blocked", async () => {
   const holder = await poolA.connect();
   let sealing;
   try {
    await begin(holder);
    await holder.query("INSERT INTO hunt_accounts(account,incarnation) VALUES('fence-holder',$1)", [randomUUID()]);
    const holderPid = (await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    sealing = seal(poolA);
    const waiter = await waiterOn(control, holderPid);
    const lock = (await control.query("SELECT locktype, mode, classid::text AS key, objsubid FROM pg_locks WHERE pid=$1 AND NOT granted", [waiter])).rows[0];
    assert.deepEqual(lock, { locktype: "advisory", mode: "ExclusiveLock", key: "80109", objsubid: 2 });
    const other = await poolB.connect();
    try {
     await other.query("SET lock_timeout='1s'");
     await begin(other);
     await other.query("INSERT INTO hunt_accounts(account,incarnation) VALUES('schema-b',$1)", [randomUUID()]);
     await other.query("COMMIT");
    } finally { await other.query("RESET lock_timeout"); other.release(); }
    const queued = await poolA.connect();
    try {
     await queued.query("SET lock_timeout='300ms'");
     await assert.rejects(begin(queued), { code: "55P03" });
     await queued.query("ROLLBACK");
    } finally { await queued.query("RESET lock_timeout"); queued.release(); }
    await holder.query("COMMIT");
    firstSeal = (await sealing).sealId;
    const order = (await poolA.query("SELECT (SELECT xmin::text::bigint FROM hunt_accounts WHERE account='fence-holder') < (SELECT xmin::text::bigint FROM scoat_lineage) AS before_seal")).rows[0].before_seal;
    assert.equal(order, true);
    await assert.rejects(retryTransaction(poolA, client => client.query("INSERT INTO hunt_accounts(account,incarnation) VALUES('after-seal',$1)", [randomUUID()])), refusedWith("sealed"));
    assert.equal((await poolA.query("SELECT count(*)::integer AS count FROM hunt_accounts WHERE account='after-seal'")).rows[0].count, 0);
    assert.equal((await inspect(poolB)).kind, "admitted");
    return { waiter: lock, holderWriteBeforeSeal: order };
   } finally { holder.release(); }
  });

  await gate("R6 original-shape negative: a database-wide lineage key blocks schema B", async () => {
   const holder = await poolA.connect(), sealer = await poolA.connect(), other = await poolB.connect();
   try {
    await holder.query("BEGIN");
    await holder.query("SELECT pg_advisory_xact_lock_shared(80109)");
    await sealer.query("BEGIN");
    const pending = sealer.query("SELECT pg_advisory_xact_lock(80109)");
    await waiterOn(control, (await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    await other.query("SET lock_timeout='300ms'");
    await other.query("BEGIN");
    await assert.rejects(other.query("SELECT pg_advisory_xact_lock_shared(80109)"), { code: "55P03" });
    await other.query("ROLLBACK");
    await holder.query("ROLLBACK");
    await pending;
    await sealer.query("ROLLBACK");
    return { label: "emulated original unscoped key", blocked: true };
   } finally { await other.query("RESET lock_timeout"); holder.release(); sealer.release(); other.release(); }
  });

  await gate("R6 original-shape negative: a transaction opened without the shared lineage lock commits after the seal", async () => {
   const holder = await poolB.connect();
   try {
    await holder.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    assert.equal((await inspect(holder)).kind, "admitted");
    await holder.query("INSERT INTO hunt_accounts(account,incarnation) VALUES('unfenced',$1)", [randomUUID()]);
    const { sealId } = await Promise.race([seal(poolB), new Promise((_, reject) => setTimeout(() => reject(new Error("Seal waited")), 5000))]);
    await holder.query("COMMIT");
    assert.equal((await inspect(poolB)).kind, "sealed");
    assert.equal((await poolB.query("SELECT count(*)::integer AS count FROM hunt_accounts WHERE account='unfenced'")).rows[0].count, 1);
    assert.equal(await unseal(poolB, sealId), "unsealed");
    return { label: "emulated hold-free opener", sealCompletedBeforeCommit: true };
   } finally { holder.release(); }
  });

  await gate("Admitted capability is bound to its database and schema", async () => {
   await assert.rejects(WatchQueue.open(await admit(poolB, "server"), inSchema(fence.url, schemaA), "producer"), refusedWith("sealed"));
   assert.equal(await unseal(poolA, firstSeal), "unsealed");
   const fromB = await admit(poolB, "server");
   await assert.rejects(WatchQueue.open(fromB, inSchema(fence.url, schemaA), "producer"), refusedWith("capability-scope"));
   await assert.rejects(WatchQueue.open(fromB, inSchema(live.url, schema), "producer"), refusedWith("identity-mismatch"));
   return { refused: ["sealed", "capability-scope", "identity-mismatch"] };
  });

  await gate("Unseal before consumption reopens; after an emulated S2 consumption the source stays sealed", async () => {
   const { sealId } = await seal(poolA);
   const consumer = await poolA.connect();
   try {
    await consumer.query("BEGIN");
    await consumer.query("SELECT pg_advisory_xact_lock(80109, hashtext(current_schema()))");
    const consumed = await consumer.query(`UPDATE scoat_lineage SET consumed_by=$2, identity=${bind} WHERE state='sealed' AND seal_id=$1 AND consumed_by IS NULL AND identity=scoat_lineage_identity(xmin::text::numeric)`, [sealId, "emulated-target-locator"]);
    assert.equal(consumed.rowCount, 1);
    await consumer.query("COMMIT");
   } finally { consumer.release(); }
   await assert.rejects(unseal(poolA, sealId), refusedWith("consumed"));
   const state = await inspect(poolA);
   assert.equal(state.kind, "sealed");
   assert.equal(state.consumedBy, "emulated-target-locator");
   const unsafe = await poolA.connect();
   try {
    await unsafe.query("BEGIN");
    const reopened = await unsafe.query(`UPDATE scoat_lineage SET state='admitted', seal_id=NULL, consumed_by=NULL, identity=${bind} WHERE state='sealed' AND seal_id=$1`, [sealId]);
    assert.equal(reopened.rowCount, 1);
    await unsafe.query("ROLLBACK");
   } finally { unsafe.release(); }
   return { label: "S2 consume emulated by its CAS predicate; original unconditional unseal would reopen (rolled back)" };
  });

  await gate("Lineage writes bind the new row xmin; a savepoint-wrapped write strands the schema", async () => {
   const writer = await poolB.connect();
   try {
    await writer.query("BEGIN");
    await writer.query("INSERT INTO hunt_accounts(account,incarnation) VALUES('bind-control',$1)", [randomUUID()]);
    await writer.query(`UPDATE scoat_lineage SET changed_at=clock_timestamp(), identity=${bind}`);
    await writer.query("COMMIT");
    assert.equal((await inspect(poolB)).kind, "admitted");
    await writer.query("BEGIN");
    await writer.query("SAVEPOINT lineage");
    await writer.query(`UPDATE scoat_lineage SET changed_at=clock_timestamp(), identity=${bind}`);
    await writer.query("RELEASE SAVEPOINT lineage");
    await writer.query("COMMIT");
   } finally { writer.release(); }
   assert.deepEqual((await lineageRow(poolB)).differing, ["rowXmin"]);
   assert.deepEqual(await inspect(poolB), { kind: "unadmitted", reason: "identity-mismatch" });
   return { topLevel: "admitted", savepoint: "identity-mismatch" };
  });

  await gate("Fresh pristine install is admitted; a template copy carrying its admitted flag is refused", async () => {
   const pristine = await database("s1_pristine");
   await exec(process.execPath, ["scripts/database.mjs", "migrate"], { cwd: checkout, env: { ...process.env, DATABASE_URL: pristine.url } });
   const pristinePool = open(pristine.url);
   assert.equal((await inspect(pristinePool)).kind, "admitted");
   await admit(pristinePool, "server");
   await pristinePool.end();
   pools.splice(pools.indexOf(pristinePool), 1);
   await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [pristine.name]);
   const clone = await database("s1_clone", pristine.name);
   const clonePool = open(clone.url);
   const row = await lineageRow(clonePool);
   assert.equal(row.state, "admitted");
   assert.deepEqual(row.differing, ["databaseOid"]);
   await assert.rejects(admit(clonePool, "server"), refusedWith("identity-mismatch"));
   return { cloneDiffering: row.differing };
  });

  await gate("Schema-behind and populated P08 data without lineage refuse server and worker without changes", async () => {
   const legacy = await database("s1_legacy");
   const folder = path.join(root, "migrations-p08");
   await mkdir(path.join(folder, "meta"), { recursive: true });
   const journal = JSON.parse(await readFile(path.join(checkout, "db/migrations/meta/_journal.json"), "utf8"));
   const p08 = journal.entries.filter(entry => entry.tag !== "0004_lineage");
   for (const entry of p08) await copyFile(path.join(checkout, "db/migrations", entry.tag + ".sql"), path.join(folder, entry.tag + ".sql"));
   await writeFile(path.join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: p08 }));
   const legacyPool = open(legacy.url);
   const client = await legacyPool.connect();
   try { await migrate(drizzle(client), { migrationsFolder: folder }); } finally { client.release(); }
   const behind = await launch(new URL("../dist/server.js", import.meta.url), serverEnv(legacy.url));
   assert.equal(behind.code, 78, behind.stderr);
   assert.match(behind.stderr, /"reason":"schema-behind"/);
   await legacyPool.query("INSERT INTO hunt_accounts(account,incarnation) VALUES('p08-account',$1)", [randomUUID()]);
   await legacyPool.query("INSERT INTO oauth_artifacts(model,id,payload,expires_at) VALUES('Session','p08',$1,now()-interval '1 hour')", [{}]);
   await exec(process.execPath, ["scripts/database.mjs", "migrate"], { cwd: checkout, env: { ...process.env, DATABASE_URL: legacy.url } });
   assert.deepEqual(await inspect(legacyPool), { kind: "unadmitted", reason: "populated-without-lineage" });
   const before = await digest(legacy.url);
   const server = await launch(new URL("../dist/server.js", import.meta.url), serverEnv(legacy.url));
   const worker = await launch(new URL("../dist/worker.js", import.meta.url), { DATABASE_URL: legacy.url, SCOAT_WATCH_CONFIG: w.root + "/watch.json" });
   for (const result of [server, worker]) {
    assert.equal(result.code, 78, result.stderr);
    assert.match(result.stderr, /"reason":"populated-without-lineage"/);
   }
   assert.deepEqual(await digest(legacy.url), before);
   return { schemaBehind: behind.code, populated: [server.code, worker.code] };
  });
 } finally {
  if (watch) await watch.close().catch(error => gates.push({ name: "watch fixture cleanup", status: "FAIL", error: String(error) }));
  for (const pool of pools) await pool.end().catch(() => {});
  for (const db of databases) {
   await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [db]);
   await admin.query(`DROP DATABASE IF EXISTS ${db}`);
  }
  await admin.query(`DROP ROLE IF EXISTS ${role}`);
  await admin.end();
  const head = (await exec("git", ["rev-parse", "HEAD"], { cwd: checkout })).stdout.trim();
  const porcelain = (await exec("git", ["status", "--porcelain"], { cwd: checkout })).stdout;
  const receipt = {
   scope: "P09 S1 lineage and runtime admission (not the P09 public story)",
   head,
   porcelain,
   trackedPatchSha256: createHash("sha256").update((await exec("git", ["diff", "HEAD"], { cwd: checkout, maxBuffer: 1 << 26 })).stdout).digest("hex"),
   environment,
   gates,
   forbidden: [
    { shape: "selective data-only restore of other tables excluding lineage", status: "FORBIDDEN, undetectable by row identity", evidence: "S0 X2 table" },
    { shape: "snapshot or volume rollback of live with no later lineage write", status: "FORBIDDEN, undetectable", evidence: "S0 X2 table" },
    { shape: "owner-role recomputation of the bind expression after a data-only restore", status: "FORBIDDEN, copy detection is not tamper evidence", evidence: "S0 X2 table" },
    { shape: "in-place pg_restore --clean over live", status: "FORBIDDEN, fails closed and strands live", evidence: "S0 X2 table" },
   ],
   untested: ["managed PostgreSQL pg_control_* and pg_walfile_name permissions", "failover on managed providers", "two-database sealed handoff consume/bind (S2)"],
   databases,
   role,
  };
  await writeFile(path.join(root, "receipt.json"), JSON.stringify(receipt, null, 1) + "\n");
  process.stdout.write(JSON.stringify({ receipt: path.join(root, "receipt.json"), gates: gates.map(item => item.name + ": " + item.status) }, null, 1) + "\n");
 }
});
