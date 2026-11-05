import type pg from "pg";
import { openPool } from "./db/pool.js";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Delivery } from "./delivery/index.js";
import { WatchQueue } from "./queue/index.js";
import { Watches, watchConfigSchema } from "./memory/watches.js";
import type { WatchConfig, WatchPause } from "./memory/watches.js";
import { admit, LineageRefused } from "./db/lineage.js";
import type { Admitted } from "./db/lineage.js";
import { verifyRelease } from "./release.js";

export type WorkerOptions = Readonly<{ databaseUrl: string; config: WatchConfig; delivery: Delivery; concurrency: number; initialPlan: boolean; pause?: WatchPause; refused: (error: LineageRefused) => void }>;

export async function startWorker(options: WorkerOptions) {
 if (!options.delivery.canSubmit) throw new Error("Watch worker requires a mail transport; refusing before queue work or submission markers");
 const pool = openPool({ connectionString: options.databaseUrl, max: options.concurrency + 2 });
 let admitted: Admitted;
 let queue: WatchQueue;
 try {
  admitted = await admit(pool, "worker");
  queue = await WatchQueue.open(admitted, options.databaseUrl, "worker");
 } catch (error) {
  await pool.end();
  throw error;
 }
 const guarded = async (run: () => Promise<unknown>): Promise<void> => {
  try {
   await run();
  } catch (error) {
   if (error instanceof LineageRefused) options.refused(error);
   throw error;
  }
 };
 const watches = new Watches({ admitted, delivery: options.delivery, config: options.config, enqueue: queue, ...(options.pause ? { pause: options.pause } : {}) });
 await queue.work({ plan: () => guarded(() => watches.plan()), check: job => guarded(() => watches.check(job)), send: job => guarded(() => watches.send(job)) }, options.concurrency);
 if (options.initialPlan) await queue.triggerPlan();
 return {
  watches,
  queue,
  async stop() {
   await queue.stop();
   await pool.end();
  },
 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const verified = await verifyRelease();
 if (verified.kind !== "verified") {
  process.stderr.write(JSON.stringify({ event: "artifact_refused", reason: verified.reason }) + "\n");
  process.exit(78);
 }
 const databaseUrl = process.env.DATABASE_URL, configPath = process.env.SCOAT_WATCH_CONFIG;
 if (!databaseUrl || !configPath) throw new Error("DATABASE_URL and SCOAT_WATCH_CONFIG are required");
 const config = watchConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
 if (config.resendApiKey === null) throw new Error("Watch worker requires resendApiKey; refusing before queue work or submission markers");
 const refuse = (error: LineageRefused): never => {
  process.stderr.write(JSON.stringify({ event: "lineage_refused", reason: error.reason }) + "\n");
  process.exit(78);
 };
 let worker: Awaited<ReturnType<typeof startWorker>>;
 try {
  worker = await startWorker({ databaseUrl, config, delivery: Delivery.production(config.resendApiKey), concurrency: 4, initialPlan: true, refused: refuse });
 } catch (error) {
  if (!(error instanceof LineageRefused)) throw error;
  refuse(error);
 }
 const ready = { event: "worker_ready", artifact: verified.release.digest };
 process.stdout.write(JSON.stringify(ready) + "\n");
 if (process.send) process.send({ ready: true, artifact: ready.artifact });
 for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void worker.stop(); });
}
