import type pg from "pg";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { z } from "zod";

export type JournalEntry = Readonly<{ tag: string; hash: string; millis: number; sql: readonly string[] }>;
export type ReleaseJournal = Readonly<{ entries: readonly JournalEntry[]; head: JournalEntry }>;
export type JournalStatus = "current" | "behind" | "ahead" | "drift" | "absent";
export type InstalledJournal = Readonly<{ status: JournalStatus; current: string | null }>;

export class JournalRefused extends Error {
 constructor(readonly status: "ahead" | "drift") { super("Migration journal refused: " + status); }
}

const metaSchema = z.strictObject({
 version: z.string().min(1).max(8),
 dialect: z.literal("postgresql"),
 entries: z.array(z.strictObject({ idx: z.number().int().min(0), version: z.string().min(1).max(8), when: z.number().int().positive(), tag: z.string().regex(/^[0-9]{4}_[a-z0-9_]{1,58}$/), breakpoints: z.boolean() })).min(1).max(1000),
});
const presentSchema = z.strictObject({ present: z.boolean() });
const installedSchema = z.array(z.strictObject({ hash: z.string().min(1).max(128), created_at: z.string().regex(/^[0-9]{1,16}$/) }));

export async function releaseJournal(folder: string): Promise<ReleaseJournal> {
 const meta = metaSchema.parse(JSON.parse(await readFile(path.join(folder, "meta/_journal.json"), "utf8")));
 const files = readMigrationFiles({ migrationsFolder: folder });
 if (files.length !== meta.entries.length) throw new Error("Migration journal and files disagree");
 const entries = meta.entries.map((entry, index): JournalEntry => {
  const file = files[index];
  if (file === undefined || file.folderMillis !== entry.when) throw new Error("Migration journal and files disagree");
  return { tag: entry.tag, hash: file.hash, millis: file.folderMillis, sql: file.sql };
 });
 const head = entries[entries.length - 1];
 if (head === undefined) throw new Error("Migration journal is empty");
 return { entries, head };
}

type InstalledRow = z.infer<typeof installedSchema>[number];

function classify(rows: readonly InstalledRow[], release: ReleaseJournal): InstalledJournal {
 const last = rows[rows.length - 1];
 if (last === undefined) return { status: "absent", current: null };
 const current = release.entries.find(entry => entry.millis === Number(last.created_at) && entry.hash === last.hash)?.tag ?? "unknown-" + last.created_at;
 const prefix = rows.every((row, index) => release.entries[index]?.hash === row.hash && release.entries[index]?.millis === Number(row.created_at));
 if (prefix) return { status: rows.length === release.entries.length ? "current" : "behind", current };
 if (rows.some(row => Number(row.created_at) > release.head.millis)) return { status: "ahead", current };
 return { status: "drift", current };
}

async function installedRows(client: Pick<pg.PoolClient, "query">): Promise<readonly InstalledRow[] | null> {
 const { present } = presentSchema.parse((await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present")).rows[0]);
 if (!present) return null;
 return installedSchema.parse((await client.query("SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id")).rows);
}

export async function installedJournal(client: Pick<pg.PoolClient, "query">, release: ReleaseJournal): Promise<InstalledJournal> {
 const rows = await installedRows(client);
 return rows === null ? { status: "absent", current: null } : classify(rows, release);
}

export async function applyPending(client: pg.PoolClient, release: ReleaseJournal): Promise<number> {
 await client.query("SELECT pg_advisory_xact_lock(80101)");
 await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
 await client.query("CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)");
 const rows = await installedRows(client) ?? [];
 const { status } = classify(rows, release);
 if (status === "ahead" || status === "drift") throw new JournalRefused(status);
 let applied = 0;
 for (const migration of release.entries.slice(rows.length)) {
  for (const statement of migration.sql) await client.query(statement);
  await client.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [migration.hash, migration.millis]);
  applied++;
 }
 return applied;
}
