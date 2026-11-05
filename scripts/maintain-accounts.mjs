import pg from "pg";
import { maintainAccounts } from "../dist/accounts/maintenance.js";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
try { console.log(JSON.stringify(await maintainAccounts(pool,100))); } finally { await pool.end(); }
