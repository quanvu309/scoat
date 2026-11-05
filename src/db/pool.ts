import pg from "pg";

export type PoolOptions = Readonly<{ connectionString: string; max: number; connectionTimeoutMillis?: number }>;

export function openPool(options: PoolOptions): pg.Pool {
 const pool = new pg.Pool({ ...options });
 pool.on("error", () => { process.stderr.write(JSON.stringify({ event: "database_connection_lost" }) + "\n"); });
 return pool;
}
