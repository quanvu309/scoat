import type pg from "pg";
import { retryTransaction } from "../db/transaction.js";
export async function maintainAccounts(pool: pg.Pool, limit = 100) {
 if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Maintenance limit must be 1..1000");
 const counts: Record<string,number> = {};
 for (const [table,column] of [["account_suppression","purge_after"],["erase_status","expires_at"],["oauth_browser_flows","expires_at"],["oauth_artifacts","expires_at"]]) {
  const result = await retryTransaction(pool, client => client.query(`DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table} WHERE ${column}<now() ORDER BY ${column} LIMIT $1 FOR UPDATE SKIP LOCKED)`,[limit]));
  counts[String(table)] = result.rowCount ?? 0;
 }
 const commands = await retryTransaction(pool, client => client.query("UPDATE memory_commands SET command=NULL,approved=false WHERE ctid IN (SELECT ctid FROM memory_commands WHERE expires_at<now() AND command IS NOT NULL ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED)",[limit]));
 counts.proposalPayloads = commands.rowCount ?? 0;
 const accounts = await retryTransaction(pool, client => client.query("DELETE FROM hunt_accounts WHERE ctid IN (SELECT ctid FROM hunt_accounts WHERE erased AND erased_at<now()-interval '31 days' ORDER BY erased_at LIMIT $1 FOR UPDATE SKIP LOCKED)",[limit]));
 counts.expiredAccounts = accounts.rowCount ?? 0;
 return counts;
}
