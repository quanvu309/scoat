import pg from "pg";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Delivery } from "./delivery/index.js";
import { WatchQueue } from "./queue/index.js";
import { Watches, watchConfigSchema } from "./memory/watches.js";
import type { WatchConfig, WatchPause } from "./memory/watches.js";

export type WorkerOptions = Readonly<{ databaseUrl: string; config: WatchConfig; delivery: Delivery; concurrency: number; initialPlan: boolean; pause?: WatchPause }>;

export async function startWorker(options: WorkerOptions) {
 const pool = new pg.Pool({ connectionString: options.databaseUrl, max: options.concurrency + 2 });
 let queue: WatchQueue;
 try {
  queue = await WatchQueue.open(options.databaseUrl, "worker");
 } catch (error) {
  await pool.end();
  throw error;
 }
 const watches = new Watches({ pool, delivery: options.delivery, config: options.config, enqueue: queue, ...(options.pause ? { pause: options.pause } : {}) });
 await queue.work({ plan: async () => { await watches.plan(); }, check: async job => { await watches.check(job); }, send: async job => { await watches.send(job); } }, options.concurrency);
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
 const databaseUrl = process.env.DATABASE_URL, configPath = process.env.SCOAT_WATCH_CONFIG;
 if (!databaseUrl || !configPath) throw new Error("DATABASE_URL and SCOAT_WATCH_CONFIG are required");
 const config = watchConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
 const worker = await startWorker({ databaseUrl, config, delivery: Delivery.production(config.resendApiKey), concurrency: 4, initialPlan: true });
 if (process.send) process.send({ ready: true });
 for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void worker.stop(); });
}
