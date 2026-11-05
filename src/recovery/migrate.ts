import type pg from "pg";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { z } from "zod";

const lastSchema = z.strictObject({ created_at: z.string().regex(/^[0-9]{1,16}$/) });

export async function applyPending(client: pg.PoolClient, folder: string): Promise<number> {
 const migrations = readMigrationFiles({ migrationsFolder: folder });
 await client.query("SELECT pg_advisory_xact_lock(80101)");
 await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
 await client.query("CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)");
 const [last] = (await client.query("SELECT created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1")).rows;
 const after = last === undefined ? null : Number(lastSchema.parse(last).created_at);
 let applied = 0;
 for (const migration of migrations) {
  if (after !== null && after >= migration.folderMillis) continue;
  for (const statement of migration.sql) await client.query(statement);
  await client.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [migration.hash, migration.folderMillis]);
  applied++;
 }
 return applied;
}
