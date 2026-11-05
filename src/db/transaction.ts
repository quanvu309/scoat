import type pg from "pg";
export class SerializationConflict extends Error { readonly code = "40001"; }
export async function retryTransaction<T>(pool: pg.Pool, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
 for (let attempt=0; ;attempt++) {
  const client = await pool.connect();
  try {
   await client.query("BEGIN");
   const result = await run(client);
   await client.query("COMMIT");
   return result;
  } catch(error) {
   await client.query("ROLLBACK");
   if (attempt<2 && error instanceof Error && "code" in error && ["40001","40P01"].includes(String(error.code))) continue;
   throw error;
  } finally { client.release(); }
 }
}
