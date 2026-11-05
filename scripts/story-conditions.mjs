import { retryTransaction } from "../dist/db/transaction.js";

const terminal = "state IN ('created','retry','active')";

export function storyConditions(w, record) {
 const read = async (sql, params = []) => {
  const client = await w.pool.connect();
  try {
   await client.query("BEGIN READ ONLY");
   const result = await client.query(sql, params);
   await client.query("COMMIT");
   return result.rows;
  } catch (error) {
   await client.query("ROLLBACK").catch(() => undefined);
   throw error;
  } finally { client.release(); }
 };
 const queue = async job => (await read(`SELECT count(*) FILTER (WHERE ${terminal})::integer AS pending, count(*) FILTER (WHERE name='watch-daily' AND state='completed')::integer AS plans, count(*) FILTER (WHERE name='watch-check' AND state='completed' AND data @> $1::jsonb)::integer AS checked, count(*) FILTER (WHERE state='failed')::integer AS failed, coalesce(jsonb_agg(jsonb_build_object('name',name,'state',state,'data',data,'output',output) ORDER BY created_on) FILTER (WHERE name<>'watch-daily'),'[]') AS jobs FROM ${w.queueSchema}.job`, [JSON.stringify(job ?? {})]))[0];
 const signal = name => {
  const process = w.workerProcess();
  if (!process) throw new Error("No fixture worker is running");
  process.kill(name);
 };
 return {
  read,
  queue,
  async settle({ plans, job = null }, timeout = 45000) {
   const until = Date.now() + timeout;
   for (;;) {
    const state = await queue(job);
    if (state.failed) throw new Error("Queue job failed: " + JSON.stringify(state.jobs).slice(0, 3000));
    if (state.pending === 0 && state.plans >= plans && (!job || state.checked === 1)) return { pending: state.pending, plans: state.plans, checked: job ? state.checked : null };
    if (Date.now() > until) throw new Error("Queue did not settle: " + JSON.stringify(state).slice(0, 3000));
    await new Promise(resolve => setTimeout(resolve, 250));
   }
  },
  seller: {
   setPence(pence) {
    record({ condition: "seller.setPence", pence, deliveredPence: pence + 380, boundary: "SYNTHETIC local TLS Pi Hut recording; product price field rewritten in the served page" });
    w.state.pence = pence;
   },
   hits: () => w.state.hits,
  },
  identity: {
   async login(page) {
    record({condition:"identity.login",boundary:"fixture mail capture entered in native local code form"});
    await w.f.advanceLoginWindow();
    await w.f.nativeLogin(page,false);
   },
   async setEmail(claims) {
    record({ condition: "identity.setEmail", verified: claims.email_verified === true, boundary: "fixture address change authenticated by both local email codes" });
    await w.f.setEmail(claims);
   },
  },
  schedule: {
   async tick() {
    record({ condition: "schedule.tick", boundary: "real pg-boss daily plan job sent through WatchQueue.triggerPlan; executed by the fixture worker" });
    await w.producer.triggerPlan();
   },
   async nextDayCheck(job) {
    record({ condition: "schedule.nextDayCheck", watch: job.watch, day: job.day, boundary: "check job enqueued through the public Enqueue contract inside a fenced transaction" });
    await retryTransaction(w.pool, client => w.producer.check(client, job));
   },
  },
  worker: {
   async start() {
    const started = await w.startWorker();
    record({ condition: "worker.start", pid: started.process.pid, artifact: started.message.artifact, boundary: "compiled startWorker with the local TLS mail capture delivery" });
    return started.message;
   },
   pause() { record({ condition: "worker.pause", signal: "SIGSTOP" }); signal("SIGSTOP"); },
   resume() { record({ condition: "worker.resume", signal: "SIGCONT" }); signal("SIGCONT"); },
   async stop() { record({ condition: "worker.stop", signal: "SIGTERM" }); await w.killWorker("SIGTERM"); },
  },
  mail: {
   next: () => w.nextAccepted(),
   deliveries: () => w.deliveries(),
   requests: () => w.requests(),
  },
 };
}
