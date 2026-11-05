import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { checkMigrationAdmission, checkJournalReadiness, checkRequestLineage, checkFixtureJournal } from "../scripts/check-runtime-lineage.mjs";

const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const original = file => execFileSync("git", ["show", "655c490:" + file], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 1 << 24 });
const replaced = (source, from, to) => { assert.ok(source.includes(from), "missing " + from); return source.replace(from, to); };
const migration = { database: read("scripts/database.mjs"), lineage: read("src/db/lineage.ts"), journal: read("src/db/journal.ts") };
const readiness = { readiness: read("src/readiness.ts"), lineage: migration.lineage, journal: migration.journal };
const server = read("src/server.ts");

test("fixture journals certify real base migrations before private schema setup; the original synthetic journal fails", () => {
 const inputs = { fixture: read("scripts/auth-fixture.mjs"), journal: read("scripts/fixture-journal.mjs") };
 assert.doesNotThrow(() => checkFixtureJournal(inputs));
 assert.throws(() => checkFixtureJournal({ ...inputs, journal: execFileSync("git", ["show", "9290141:scripts/fixture-journal.mjs"], { encoding: "utf8" }) }), /never synthetic journal rows/);
 assert.throws(() => checkFixtureJournal({ ...inputs, fixture: replaced(inputs.fixture, "await migrateFixtureDatabase(admin);", "await migrateFixtureDatabase(store.pool);") }), /base database/);
 assert.throws(() => checkFixtureJournal({ ...inputs, fixture: replaced(inputs.fixture, "await migrateFixtureDatabase(admin);", "") }), /base database/);
});

test("migrate admits through the lineage gate; the original unfenced drizzle migrate fails", () => {
 assert.doesNotThrow(() => checkMigrationAdmission(migration));
 assert.throws(() => checkMigrationAdmission({ ...migration, database: original("scripts/database.mjs") }), /only through the lineage-owned admission gate/);
 assert.throws(() => checkMigrationAdmission({ ...migration, database: replaced(migration.database, "await migrateAdmitted(pool, client => applyPending(client, release))", "await (async () => { const client = await pool.connect(); try { return await applyPending(client, release); } finally { client.release(); } })()") }), /only inside migrateAdmitted/);
 assert.throws(() => checkMigrationAdmission({ ...migration, database: replaced(migration.database, "      process.exitCode = 78;\n", "") }), /exits 78/);
 assert.throws(() => checkMigrationAdmission({ ...migration, database: replaced(migration.database, "      await begin(client);\n", "") }), /inside the shared lineage begin/);
});

test("the gate checks catalog presence and admission before DDL and an admitted result before commit", () => {
 assert.throws(() => checkMigrationAdmission({ ...migration, lineage: replaced(migration.lineage, "  if (present) await requireAdmitted(client);\n", "") }), /require admission before DDL/);
 assert.throws(() => checkMigrationAdmission({ ...migration, lineage: replaced(migration.lineage, "  const result = await run(client);\n  await requireAdmitted(client);\n", "  const result = await run(client);\n") }), /admitted result before commit/);
 assert.throws(() => checkMigrationAdmission({ ...migration, lineage: replaced(migration.lineage, "SELECT to_regclass(quote_ident(current_schema()) || '.scoat_lineage') IS NOT NULL AS present", "SELECT count(*) > 0 AS present FROM scoat_lineage") }), /check catalog presence/);
 assert.throws(() => checkMigrationAdmission({ ...migration, lineage: replaced(migration.lineage, " return exclusive(pool, async client => {\n  const { present }", " return withClient(pool, async client => {\n  const { present }") }), /exclusive lineage lock/);
 assert.throws(() => checkMigrationAdmission({ ...migration, journal: replaced(migration.journal, " if (status === \"ahead\" || status === \"drift\") throw new JournalRefused(status);\n", "") }), /ahead of or different/);
});

test("readiness compares the installed journal; the original lineage schema-head readiness fails", () => {
 assert.doesNotThrow(() => checkJournalReadiness(readiness));
 assert.throws(() => checkJournalReadiness({ ...readiness, readiness: original("src/readiness.ts") }), /never the lineage schema head/);
 assert.throws(() => checkJournalReadiness({ ...readiness, lineage: original("src/db/lineage.ts") }), /installed journal through its owner/);
 assert.throws(() => checkJournalReadiness({ ...readiness, readiness: replaced(readiness.readiness, "const schemaStatus = installed === null ? \"unknown\" : installed.status;", "const schemaStatus = installed === null ? \"unknown\" : \"current\";") }), /shipped release journal/);
 assert.throws(() => checkJournalReadiness({ ...readiness, journal: replaced(readiness.journal, " const { present } = presentSchema.parse((await client.query(\"SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present\")).rows[0]);\n if (!present) return null;\n", "") }), /journal presence in the catalog/);
});

test("a mid-request lineage refusal maps to 503 on every request path; the original 400 and generic MCP catches fail", () => {
 assert.doesNotThrow(() => checkRequestLineage(server));
 assert.throws(() => checkRequestLineage(original("src/server.ts")), /reports 503/);
 assert.throws(() => checkRequestLineage(replaced(server, "      } catch (error) {\n        if (error instanceof LineageRefused) {\n          refuseLineage(res, error.reason);\n          return;\n        }\n        process.stderr.write(JSON.stringify({ event: \"authentication_request_refused\" }) + \"\\n\");", "      } catch (error) {\n        process.stderr.write(JSON.stringify({ event: \"authentication_request_refused\" }) + \"\\n\");")), /: route/);
 assert.throws(() => checkRequestLineage(replaced(server, "      if (error instanceof LineageRefused) {\n        refuseLineage(res, error.reason);\n        return;\n      }\n      if (!(error instanceof InvalidCredential)) {", "      if (!(error instanceof InvalidCredential)) {")), /: authenticate/);
 assert.throws(() => checkRequestLineage(replaced(server, "      } catch (error) {\n        if (error instanceof LineageRefused) invocationRefusal = error.reason;\n        throw error;\n      } finally {", "      } finally {")), /: invoke/);
 assert.throws(() => checkRequestLineage(replaced(server, "    } catch (error) {\n      if (error instanceof LineageRefused) {\n        refuseLineage(res, error.reason);\n        return;\n      }\n      process.stderr.write(JSON.stringify({ event: \"mcp_request_refused\" }) + \"\\n\");", "    } catch {\n      process.stderr.write(JSON.stringify({ event: \"mcp_request_refused\" }) + \"\\n\");")), /: handleRequest/);
});

test("invoke-time seals have one HTTP response owner; the original double-write fails", () => {
 const old = execFileSync("git", ["show", "9290141:src/server.ts"], { encoding: "utf8" });
 assert.throws(() => checkRequestLineage(old), /without writing a response/);
 assert.throws(() => checkRequestLineage(replaced(server, "invocationRefusal = error.reason;", "refuseLineage(res, error.reason);")), /without writing a response/);
 assert.throws(() => checkRequestLineage(replaced(server, "invocationRefusal !== undefined", "false && invocationRefusal !== undefined")), /one HTTP 503/);
 assert.throws(() => checkRequestLineage(replaced(server, "{ status: 503 }", "{ status: 200 }")), /one HTTP 503/);
 assert.throws(() => checkRequestLineage(replaced(server, "        return response;", "        return Response.json({});")), /preserve other SDK responses/);
});
