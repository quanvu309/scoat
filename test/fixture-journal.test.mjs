import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { withDatabase } from "../scripts/durable-database.mjs";
import { authFixture } from "../scripts/auth-fixture.mjs";
import { inspect, migrateAdmitted } from "../dist/db/lineage.js";
import { releaseJournal, installedJournal, applyPending } from "../dist/db/journal.js";

test("an auth fixture initialized first leaves the shared base fully migrated and repeat migration safe", { timeout: 30000 }, async () => {
 await withDatabase(async url => {
  const admin = new pg.Pool({ connectionString: url });
  const name = "fixture_journal_" + randomBytes(8).toString("hex");
  const target = new URL(url);
  target.pathname = "/" + name;
  const pool = new pg.Pool({ connectionString: target.href });
  let fixture;
  let created = false;
  try {
   await admin.query("CREATE DATABASE " + name);
   created = true;
   fixture = await authFixture(target.href);
   const release = await releaseJournal(fileURLToPath(new URL("../db/migrations", import.meta.url)));
   assert.equal((await inspect(pool)).kind, "admitted");
   assert.equal((await installedJournal(pool, release)).status, "current");
   assert.equal(await migrateAdmitted(pool, client => applyPending(client, release)), 0);
   assert.equal((await pool.query("SELECT count(*)::integer AS count FROM hunt_accounts")).rows[0].count, 0);
   assert.equal((await inspect(fixture.store.pool)).kind, "admitted");
  } finally {
   await fixture?.close();
   await pool.end();
   if (created) await admin.query("DROP DATABASE " + name);
   await admin.end();
  }
 });
});
