import pg from "pg";
import { fileURLToPath } from "node:url";

if (process.argv[2] === "migrate") {
  const { verifyRelease } = await import("../dist/release.js");
  const verified = await verifyRelease();
  if (verified.kind !== "verified") {
    process.stderr.write(JSON.stringify({ event: "artifact_refused", reason: verified.reason }) + "\n");
    process.exit(78);
  }
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required; use the lane's disposable Postgres DSN");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, max: 1 });
pool.on("error", () => { process.stderr.write(JSON.stringify({ event: "database_connection_lost" }) + "\n"); });
const { begin, migrateAdmitted, LineageRefused } = await import("../dist/db/lineage.js");
const { applyPending, JournalRefused, releaseJournal } = await import("../dist/db/journal.js");
try {
  if (process.argv[2] === "migrate") {
    const release = await releaseJournal(fileURLToPath(new URL("../db/migrations", import.meta.url)));
    try {
      const applied = await migrateAdmitted(pool, client => applyPending(client, release));
      process.stdout.write(JSON.stringify({ event: "migrated", applied, head: release.head.tag }) + "\n");
    } catch (error) {
      if (!(error instanceof LineageRefused) && !(error instanceof JournalRefused)) throw error;
      const reason = error instanceof LineageRefused ? error.reason : "schema-" + error.status;
      process.stderr.write(JSON.stringify({ event: "migration_refused", reason }) + "\n");
      process.exitCode = 78;
    }
  } else if (process.argv[2] === "seed") {
    const lane = process.argv[process.argv.indexOf("--fixture") + 1];
    if (!process.argv.includes("--fixture") || !lane || !/^[a-zA-Z0-9-]{1,64}$/.test(lane)) throw new Error("Use db:seed -- --fixture <lane-id>");
    const client = await pool.connect();
    try {
      await begin(client);
      await client.query("INSERT INTO scoat_fixture_lanes (lane, market, currency) VALUES ($1, 'GB', 'GBP') ON CONFLICT (lane) DO NOTHING", [lane]);
      const { rows } = await client.query("SELECT lane, market, currency FROM scoat_fixture_lanes WHERE lane = $1", [lane]);
      await client.query("COMMIT");
      process.stdout.write(JSON.stringify(rows) + "\n");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } else throw new Error("Use migrate or seed");
} finally {
  await pool.end();
}
