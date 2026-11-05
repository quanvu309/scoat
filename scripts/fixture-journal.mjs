import { readMigrationFiles } from "drizzle-orm/migrator";
import { fileURLToPath } from "node:url";

export async function recordFixtureJournal(pool) {
  const migrations = readMigrationFiles({ migrationsFolder: fileURLToPath(new URL("../db/migrations", import.meta.url)) });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(80101)");
    for (const statement of migrations[0].sql) await client.query(statement);
    await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
    await client.query("CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)");
    for (const migration of migrations) await client.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = $2)", [migration.hash, migration.folderMillis]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
