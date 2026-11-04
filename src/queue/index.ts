import { PgBoss } from "pg-boss";
import type { Job } from "pg-boss";
import pg from "pg";
import { createHash } from "node:crypto";
import { z } from "zod";
import { confirm } from "../db/lineage.js";
import type { Admitted } from "../db/lineage.js";

export const queueNames = { daily: "watch-daily", check: "watch-check", send: "watch-send" } as const;
export async function queueSchemaFor(client: Pick<pg.PoolClient, "query">): Promise<string> {
 const result = await client.query("SELECT current_schema() AS schema");
 const { schema } = z.strictObject({ schema: z.string().min(1) }).parse(result.rows[0]);
 return schema === "public" ? "pgboss" : "scoat_jobs_" + createHash("sha256").update(schema).digest("hex").slice(0, 32);
}
const scope = { account: z.uuid(), incarnation: z.uuid(), watch: z.uuid() };
export const checkJobSchema = z.strictObject({ ...scope, day: z.iso.date() });
export const sendJobSchema = z.strictObject({ ...scope, alert: z.uuid() });
export type CheckJob = z.infer<typeof checkJobSchema>;
export type SendJob = z.infer<typeof sendJobSchema>;
export type Enqueue = Readonly<{ check(client: pg.PoolClient, job: CheckJob): Promise<void>; send(client: pg.PoolClient, job: SendJob): Promise<void> }>;
export type Handlers = Readonly<{ plan(): Promise<void>; check(job: CheckJob): Promise<void>; send(job: SendJob): Promise<void> }>;

const caller = (client: pg.PoolClient) => ({ executeSql: async (text: string, values?: unknown[]) => ({ rows: (await client.query(text, values)).rows }) });

export async function deleteScopedJobs(client: pg.PoolClient, target: Readonly<{ account: string; incarnation: string; watch?: string }>): Promise<number> {
 const queueSchema = await queueSchemaFor(client);
 const installed = await client.query("SELECT to_regclass($1) AS job", [queueSchema + ".job"]);
 if (installed.rows[0]?.job === null) return 0;
 const filter = JSON.stringify(target.watch === undefined ? { account: target.account, incarnation: target.incarnation } : { account: target.account, incarnation: target.incarnation, watch: target.watch });
 const deleted = await client.query(`DELETE FROM ${queueSchema}.job WHERE data @> $1::jsonb`, [filter]);
 const survivors = await client.query(`SELECT count(*)::integer AS count FROM ${queueSchema}.job WHERE data @> $1::jsonb`, [filter]);
 if (survivors.rows[0]?.count !== 0) throw new Error("Queue erasure survivor");
 return deleted.rowCount ?? 0;
}

function each<T>(schema: z.ZodType<T>, run: (job: T) => Promise<void>) {
 return async (jobs: Job<unknown>[]) => {
  for (const job of jobs) await run(schema.parse(job.data));
 };
}

export class WatchQueue implements Enqueue {
 private constructor(private readonly boss: PgBoss) {}

 static async open(admitted: Admitted, connectionString: string, role: "worker" | "producer"): Promise<WatchQueue> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  let queueSchema: string;
  try {
   await confirm(pool, admitted);
   queueSchema = await queueSchemaFor(pool);
  } finally { await pool.end(); }
  const boss = new PgBoss({ connectionString, schema: queueSchema, schedule: role === "worker", supervise: role === "worker", migrate: true, persistWarnings: false, max: 4 });
  boss.on("error", () => process.stderr.write(JSON.stringify({ event: "queue_error" }) + "\n"));
  await boss.start();
  await boss.createQueue(queueNames.daily, { policy: "singleton", retryLimit: 1, expireInSeconds: 300, deleteAfterSeconds: 86400 });
  await boss.createQueue(queueNames.check, { policy: "stately", retryLimit: 3, retryDelay: 30, expireInSeconds: 60, retentionSeconds: 172800, deleteAfterSeconds: 86400 });
  await boss.createQueue(queueNames.send, { policy: "stately", retryLimit: 5, retryDelay: 60, retryBackoff: true, retryDelayMax: 3600, expireInSeconds: 60, retentionSeconds: 72000, deleteAfterSeconds: 86400 });
  if (role === "worker") await boss.schedule(queueNames.daily, "5 0 * * *", null, { tz: "UTC", missed: "once" });
  return new WatchQueue(boss);
 }

 async check(client: pg.PoolClient, job: CheckJob): Promise<void> {
  await this.boss.send(queueNames.check, checkJobSchema.parse(job), { db: caller(client), singletonKey: job.watch + ":" + job.day });
 }

 async send(client: pg.PoolClient, job: SendJob): Promise<void> {
  await this.boss.send(queueNames.send, sendJobSchema.parse(job), { db: caller(client), singletonKey: job.alert });
 }

 async triggerPlan(): Promise<void> {
  await this.boss.send(queueNames.daily, null, { singletonKey: "plan" });
 }

 async work(handlers: Handlers, concurrency: number): Promise<void> {
  await this.boss.work(queueNames.daily, { batchSize: 1, pollingIntervalSeconds: 1 }, async () => handlers.plan());
  await this.boss.work(queueNames.check, { batchSize: 1, localConcurrency: concurrency, pollingIntervalSeconds: 0.5 }, each(checkJobSchema, handlers.check));
  await this.boss.work(queueNames.send, { batchSize: 1, localConcurrency: Math.max(1, Math.floor(concurrency / 2)), pollingIntervalSeconds: 0.5 }, each(sendJobSchema, handlers.send));
 }

 async stop(): Promise<void> {
  await this.boss.stop({ graceful: true, timeout: 15000 });
 }
}
