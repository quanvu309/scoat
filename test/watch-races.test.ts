import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { withDatabase } from "../scripts/durable-database.mjs";
import { watchFixture } from "../scripts/watch-fixture.mjs";
import { retryTransaction } from "../dist/db/transaction.js";
import { eraseAccount } from "../dist/accounts/erasure.js";

test("compiled watches dedupe concurrent days and stop new sends at unwatch and erase boundaries", async () => {
 await withDatabase(async (url: string) => {
  const w = await watchFixture(url);
  try {
   const job = (seeded: { account: string; incarnation: string; watch: string }, day: string) => ({ account: seeded.account, incarnation: seeded.incarnation, watch: seeded.watch, day });
   const seeded = await w.seedWatch();
   w.state.pence = 5500;
   const raced = await Promise.all(Array.from({ length: 5 }, () => w.watches().check(job(seeded, "2027-02-01"))));
   assert.equal(raced.filter((item: { alert?: string | null }) => item.alert).length, 1);
   const alert = raced.find((item: { alert?: string | null }) => item.alert).alert;
   let open: () => void = () => undefined, hit: () => void = () => undefined;
   const reached = new Promise<void>(resolve => { hit = resolve; }), gate = new Promise<void>(resolve => { open = resolve; });
   const sending = w.watches(async (point: string) => { if (point === "marked") { hit(); await gate; } }).send({ account: seeded.account, incarnation: seeded.incarnation, watch: seeded.watch, alert });
   await reached;
   const receipt = await retryTransaction(w.pool, async (client: { query(text: string, values: unknown[]): Promise<unknown> }) => {
    const status = randomBytes(16).toString("hex");
    await client.query("INSERT INTO erase_status(digest,operation) VALUES($1,$2)", [status, randomUUID()]);
    return eraseAccount(client, seeded, w.f.config.lifecycleKey, w.f.config.lifecycleKeyVersion, status);
   });
   open();
   assert.equal(await sending, "refused");
   assert.equal(receipt.retention.watchMail.mayStillArrive, 1);
   assert.equal((await w.pool.query("SELECT count(*)::integer AS n FROM pgboss.job WHERE data @> $1::jsonb", [JSON.stringify({ account: seeded.account })])).rows[0].n, 0);
   assert.equal((await w.deliveries()).length, 0);
  } finally { await w.close(); }
 });
});
