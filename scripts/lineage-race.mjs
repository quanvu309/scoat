import { seal } from "../dist/db/lineage.js";

async function contended(pool, sql, params, label) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const { rows } = await pool.query(sql, params);
    if (rows[0]) return rows[0];
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("PostgreSQL contention not observed: " + label);
}

export async function sealRace(pool, send) {
  const holder = await pool.connect();
  let sealing = null;
  let sending = null;
  try {
    await holder.query("BEGIN");
    const { pid: holderPid } = (await holder.query("SELECT pg_backend_pid() AS pid")).rows[0];
    await holder.query("SELECT 1 FROM scoat_lineage FOR UPDATE");
    sealing = seal(pool);
    sealing.catch(() => undefined);
    const sealer = await contended(pool, "SELECT a.pid FROM pg_stat_activity a JOIN pg_locks l ON l.pid = a.pid AND l.locktype = 'advisory' AND l.classid = 80109 AND l.mode = 'ExclusiveLock' AND l.granted WHERE $1 = ANY(pg_blocking_pids(a.pid))", [holderPid], "seal holds the exclusive lineage lock and waits on the lineage row");
    sending = send();
    sending.catch(() => undefined);
    const waiter = await contended(pool, "SELECT a.pid FROM pg_stat_activity a JOIN pg_locks l ON l.pid = a.pid AND l.locktype = 'advisory' AND l.classid = 80109 AND l.mode = 'ShareLock' AND NOT l.granted WHERE $1 = ANY(pg_blocking_pids(a.pid))", [sealer.pid], "request waits on the shared lineage lock behind the seal");
    await holder.query("ROLLBACK");
    const { sealId } = await sealing;
    const response = await sending;
    return { ...response, sealId, contention: { holder: holderPid, sealer: sealer.pid, request: waiter.pid } };
  } catch (error) {
    await holder.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    holder.release();
  }
}
