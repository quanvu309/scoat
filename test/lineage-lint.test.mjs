import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { checkLineageFence, checkLineageBegin, checkLineageIdentity, checkRuntimeAdmission } from "../scripts/check-lineage.mjs";

const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const sources = [];
const collect = directory => { for (const entry of readdirSync(new URL("../" + directory, import.meta.url), { withFileTypes: true })) { const file = directory + "/" + entry.name; if (entry.isDirectory()) collect(file); else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) sources.push({ file, source: read(file) }); } };
collect("src");
const swap = (file, from, to) => { const original = sources.find(item => item.file === file).source; assert.ok(original.includes(from), file + " lacks " + from); return sources.map(item => item.file === file ? { file, source: original.replace(from, to) } : item); };
const lineage = read("src/db/lineage.ts"), transaction = read("src/db/transaction.ts"), migration = read("db/migrations/0004_lineage.sql"), schema = read("src/db/schema.ts"), journal = read("db/migrations/meta/_journal.json");
const runtime = { server: read("src/server.ts"), worker: read("src/worker.ts"), queue: read("src/queue/index.ts"), watches: read("src/memory/watches.ts"), lineage, index: read("src/index.ts") };
const replaced = (source, from, to) => { assert.ok(source.includes(from), "missing " + from); return source.replace(from, to); };

test("every transaction and write in src passes the shared lineage fence; original bypass shapes fail", () => {
 assert.doesNotThrow(() => checkLineageFence(sources));
 assert.throws(() => checkLineageFence(swap("src/db/transaction.ts", "await begin(client);", "await client.query(\"BEGIN\");")), /shared lineage begin/);
 assert.throws(() => checkLineageFence(swap("src/auth/issuer.ts", "await begin(client);", "await client.query(\"BEGIN\");")), /shared lineage begin/);
 assert.throws(() => checkLineageFence(swap("src/hunt/postgres.ts", "await begin(client);", "await client.query(\"BEGIN ISOLATION LEVEL READ COMMITTED\");")), /shared lineage begin/);
 assert.throws(() => checkLineageFence(swap("src/server.ts", "await begin(installation);", "await installation.query(\"BEGIN\");")), /shared lineage begin/);
 assert.throws(() => checkLineageFence(swap("src/auth/adapter.ts", "await transaction(client => client.query(\"DELETE FROM oauth_artifacts WHERE model=$1 AND id=$2\", [model,id]));", "await pool.query(\"DELETE FROM oauth_artifacts WHERE model=$1 AND id=$2\", [model,id]);")), /pool writes/);
 assert.throws(() => checkLineageFence(swap("src/accounts/maintenance.ts", "await retryTransaction(pool, client => client.query(\"DELETE FROM hunt_accounts", "await (async () => pool.query(\"DELETE FROM hunt_accounts")), /pool writes/);
 assert.throws(() => checkLineageFence(swap("src/hunt/postgres.ts", "await retryTransaction(this.pool, client => client.query(\"INSERT INTO hunt_accounts(account,incarnation) VALUES($1,$2)\", [account,incarnation]));", "await this.pool.query(\"INSERT INTO hunt_accounts(account,incarnation) VALUES($1,$2)\", [account,incarnation]);")), /pool writes/);
 assert.throws(() => checkLineageFence(swap("src/auth/issuer.ts", "retryTransaction(pool, client => client.query(\n", "(async () => pool.query(\n")), /pool writes/);
 assert.throws(() => checkLineageFence(swap("src/db/lineage.ts", "  const result = await run(client);", "  await client.query(\"SAVEPOINT lineage\");\n  const result = await run(client);")), /savepoints/);
 assert.throws(() => checkLineageFence(swap("src/memory/watches.ts", "await begin(client);", "await begin(client);\n   await client.query(\"SELECT state FROM scoat_lineage\");")), /lineage SQL in its owner/);
});

test("begin holds the schema-scoped shared lock before a separate admission read; lineage writes rebind xmin under the exclusive fence", () => {
 assert.doesNotThrow(() => checkLineageBegin(lineage, transaction));
 const hold = " await client.query(\"SELECT pg_advisory_xact_lock_shared(80109, hashtext(current_schema()))\");\n", read = " const state = await inspect(client);\n";
 assert.throws(() => checkLineageBegin(replaced(lineage, hold + read, read + hold), transaction), /separate statement/);
 assert.throws(() => checkLineageBegin(replaced(lineage, "pg_advisory_xact_lock_shared(80109, hashtext(current_schema()))", "pg_advisory_xact_lock_shared(80109)"), transaction), /separate statement/);
 assert.throws(() => checkLineageBegin(replaced(lineage, hold, ""), transaction), /separate statement/);
 assert.throws(() => checkLineageBegin(replaced(lineage, "SELECT pg_advisory_xact_lock(80109, hashtext(current_schema()))", "SELECT pg_advisory_xact_lock(80109)"), transaction), /exclusive lineage lock/);
 assert.throws(() => checkLineageBegin(replaced(lineage, " AND consumed_by IS NULL AND identity", " AND identity"), transaction), /before the source is consumed/);
 assert.throws(() => checkLineageBegin(replaced(lineage, "SET state='sealed', seal_id=$1, consumed_by=NULL, identity=scoat_lineage_identity(pg_current_xact_id()::text::numeric % 4294967296)", "SET state='sealed', seal_id=$1, consumed_by=NULL"), transaction), /rebinds the new row xmin/);
 assert.throws(() => checkLineageBegin(replaced(lineage, "return exclusive(pool, async client => {\n  const sealId", "return (async (client) => {\n  const sealId"), transaction), /exclusive lineage fence/);
 assert.throws(() => checkLineageBegin(lineage, replaced(transaction, "await begin(client);", "await client.query(\"BEGIN\");")), /lineage begin/);
});

test("identity binds all five physical components including row xmin and genesis only admits a pristine install", () => {
 assert.doesNotThrow(() => checkLineageIdentity(migration, lineage, schema, journal));
 assert.throws(() => checkLineageIdentity(replaced(migration, "'.scoat_lineage')::oid, row_xmin)", "'.scoat_lineage')::oid)"), lineage, schema, journal), /row xmin/);
 assert.throws(() => checkLineageIdentity(replaced(migration, "('x' || substr(pg_walfile_name(pg_current_wal_lsn()), 1, 8))::bit(32)::bigint, ", ""), lineage, schema, journal), /WAL timeline/);
 assert.throws(() => checkLineageIdentity(replaced(migration, " AND scoat_lineage_pristine();", ";"), lineage, schema, journal), /pristine installation/);
 assert.throws(() => checkLineageIdentity(migration, replaced(lineage, " && left.rowXmin === right.rowXmin", ""), schema, journal), /including row xmin/);
 assert.throws(() => checkLineageIdentity(migration, replaced(lineage, "z.strictObject({\n state:", "z.object({\n state:"), schema, journal), /Strictly parse/);
 assert.throws(() => checkLineageIdentity(migration, lineage, replaced(schema, ", \"0004_lineage\"", ""), journal), /durableSchema/);
});

test("server, worker, queue and Watches require current admission; base boot orders fail", () => {
 assert.doesNotThrow(() => checkRuntimeAdmission(runtime));
 const admitLine = "      const admitted = await admit(store.pool, \"server\");\n";
 const maintain = "      await maintainAccounts(store.pool);\n";
 assert.throws(() => checkRuntimeAdmission({ ...runtime, server: replaced(replaced(runtime.server, admitLine, ""), maintain, maintain + admitLine) }), /startup DDL, maintenance/);
 const gate = runtime.server.slice(runtime.server.indexOf("    const lineage = await lineageStatus(store.pool);\n    if (lineage !== \"admitted\")"), runtime.server.indexOf("    if (Number(req.headers[\"content-length\"]"));
 assert.throws(() => checkRuntimeAdmission({ ...runtime, server: replaced(runtime.server, gate, "") }), /before auth routes and MCP/);
 assert.throws(() => checkRuntimeAdmission({ ...runtime, worker: replaced(runtime.worker, "  admitted = await admit(pool, \"worker\");\n  queue = await WatchQueue.open(admitted, options.databaseUrl, \"worker\");", "  queue = await WatchQueue.open(admitted, options.databaseUrl, \"worker\");\n  admitted = await admit(pool, \"worker\");") }), /precedes queue open/);
 assert.throws(() => checkRuntimeAdmission({ ...runtime, worker: replaced(runtime.worker, "   if (error instanceof LineageRefused) options.refused(error);\n", "") }), /exits 78/);
 assert.throws(() => checkRuntimeAdmission({ ...runtime, queue: replaced(runtime.queue, "static async open(admitted: Admitted, connectionString: string,", "static async open(admitted: Admitted | undefined, connectionString: string,") }), /bound admitted capability/);
 assert.throws(() => checkRuntimeAdmission({ ...runtime, queue: replaced(runtime.queue, "   await confirm(pool, admitted);\n", "") }), /bound admitted capability/);
 assert.throws(() => checkRuntimeAdmission({ ...runtime, watches: replaced(runtime.watches, "constructor(deps: Readonly<{ admitted: Admitted; delivery", "constructor(deps: Readonly<{ pool: pg.Pool; admitted: Admitted; delivery") }), /required admitted capability/);
 assert.throws(() => checkRuntimeAdmission({ ...runtime, lineage: replaced(lineage, " private constructor(readonly role", " constructor(readonly role") }), /nominal/);
 assert.throws(() => checkRuntimeAdmission({ ...runtime, index: runtime.index + "\nexport { admit } from \"./db/lineage.js\";\n" }), /public barrels/);
});
