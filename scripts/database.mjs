import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

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
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(80101)");
  if (process.argv[2] === "migrate") {
    await migrate(drizzle(client), { migrationsFolder: new URL("../db/migrations", import.meta.url).pathname });
  } else if (process.argv[2] === "seed") {
    const lane = process.argv[process.argv.indexOf("--fixture") + 1];
    if (!process.argv.includes("--fixture") || !lane || !/^[a-zA-Z0-9-]{1,64}$/.test(lane)) throw new Error("Use db:seed -- --fixture <lane-id>");
    await client.query("INSERT INTO scoat_fixture_lanes (lane, market, currency) VALUES ($1, 'GB', 'GBP') ON CONFLICT (lane) DO NOTHING", [lane]);
    const { rows } = await client.query("SELECT lane, market, currency FROM scoat_fixture_lanes WHERE lane = $1", [lane]);
    process.stdout.write(JSON.stringify(rows) + "\n");
  } else throw new Error("Use migrate or seed");
} finally {
  await client.query("SELECT pg_advisory_unlock(80101)");
  client.release();
  await pool.end();
}
