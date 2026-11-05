import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { withDatabase } from "./durable-database.mjs";
import { authFixture } from "./auth-fixture.mjs";
import { confirm } from "./memory-lanes.mjs";
import { memoryEvidence } from "./memory-evidence.mjs";
import { digest } from "../dist/hunt/postgres.js";
const report = await memoryEvidence("perf");
const batches=[], eraseSamples=[], inventory=[];
await withDatabase(async url => {
 const f=await authFixture(url);
 try {
  const login=await f.login(), principal=await f.authenticate(login.token);
  const start=await f.tool(login.token,"scoat_hunt",{op:"start",requestKey:randomUUID(),profile:null,intent:{product:{kind:"description",text:"SYNTHETIC P06 performance"},variant:null,shop:null,budget:null}});
  assert.ok(start.structuredContent.ok);
  let view=start.structuredContent.value.view;
  for (const row of view.rows) for (const slot of row.slots) {
   const current=view.rows.find(entry=>entry.row.id===row.row.id);
   const recorded=await f.tool(login.token,"scoat_hunt",{op:"record",requestKey:randomUUID(),hunt:view.hunt,row:row.row.id,slot:slot.slot,expected:current.revision,outcome:{kind:"gap",reason:"SYNTHETIC unavailable"}});
   assert.ok(recorded.structuredContent.ok); view=recorded.structuredContent.value.view;
  }
  const finished=await f.tool(login.token,"scoat_hunt",{op:"finish",requestKey:randomUUID(),hunt:view.hunt,selection:null});
  assert.ok(finished.structuredContent.ok);
  const template=(await f.store.pool.query("SELECT data,release,snapshot FROM durable_hunts WHERE account=$1 AND incarnation=$2 AND id=$3",[principal.agent.account,principal.agent.incarnation,view.hunt])).rows[0];
  const rows=(await f.store.pool.query("SELECT id,data FROM hunt_rows WHERE account=$1 AND incarnation=$2 AND hunt=$3",[principal.agent.account,principal.agent.incarnation,view.hunt])).rows;
  async function seed(scope,keepOriginal=false) {
   const client=await f.store.pool.connect();
   try {
    await client.query("BEGIN");
    for (let index=keepOriginal?1:0;index<100;index++) {
     const hunt="perf-"+String(index).padStart(3,"0"), snapshot={...template.snapshot,hunt}, data={...template.data,id:hunt,account:scope.account};
     await client.query("INSERT INTO durable_hunts(account,incarnation,id,data,release,snapshot) VALUES($1,$2,$3,$4,$5,$6)",[scope.account,scope.incarnation,hunt,data,template.release,snapshot]);
     for (const row of rows) await client.query("INSERT INTO hunt_rows(account,incarnation,hunt,id,data) VALUES($1,$2,$3,$4,$5)",[scope.account,scope.incarnation,hunt,row.id,{...row.data,hunt}]);
    }
    const hunts=(await client.query("SELECT id,snapshot,release FROM durable_hunts WHERE account=$1 AND incarnation=$2",[scope.account,scope.incarnation])).rows;
    assert.equal(hunts.length,100);
    for (const hunt of hunts) await client.query("INSERT INTO memory_items(account,incarnation,id,hunt,snapshot,release,digest) VALUES($1,$2,$3,$4,$5,$6,$7)",[scope.account,scope.incarnation,randomUUID(),hunt.id,hunt.snapshot,hunt.release,digest({snapshot:hunt.snapshot,release:hunt.release,format:1})]);
    await client.query("COMMIT");
   } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  await seed(principal.agent,true);
  async function page(after) {
   const before=performance.now();
   const result=await f.tool(login.token,"scoat_memory",{op:"read",collection:"saved",limit:20,...(after?{after}: {})});
   const ms=performance.now()-before;
   assert.ok(!result.isError,JSON.stringify(result));
   return {value:result.structuredContent.value,ms};
  }
  for (let n=0;n<10;n++) await page();
  for (let batch=0;batch<5;batch++) {
   const samples=[];
   for (let cycle=0;cycle<20;cycle++) {
    let after;
    let count=0;
    do { const result=await page(after); count+=result.value.items.length; samples.push({ms:result.ms,items:result.value.items.length}); after=result.value.next; } while(after);
    assert.equal(count,100);
   }
   assert.equal(samples.length,100);
   batches.push({batch,samples,p95Ms:samples.map(value=>value.ms).sort((a,b)=>a-b)[94]});
  }
  for (let batch=0;batch<5;batch++) {
   const actor=batch===0?login:await f.login("host-one","perf-erase-"+batch);
   const authority=await f.authenticate(actor.token);
   if (batch>0) await seed(authority.agent);
   const prepared=await confirm(f,f.issuer+"/account/erase","/account/erase","erase",false);
   const begin=performance.now();
   const erased=await f.browser(prepared.url,{method:"POST",headers:{origin:f.issuer,"content-type":"application/x-www-form-urlencoded"},body:prepared.body});
   const receipt=await erased.json(), ms=performance.now()-begin;
   assert.equal(erased.status,200,JSON.stringify(receipt));
   assert.equal(receipt.counts.durable_hunts,100); assert.equal(receipt.counts.memory_items,100); assert.equal(receipt.retention.jobs,0);
   assert.equal((await f.store.pool.query("SELECT count(*) FROM durable_hunts WHERE account=$1",[authority.agent.account])).rows[0].count,"0");
   eraseSamples.push({batch,ms}); inventory.push(receipt.counts);
  }
 } finally { await f.close(); }
});
const passed=batches.every(batch=>batch.p95Ms<=500)&&eraseSamples.every(sample=>sample.ms<=5000);
await report.save("perf.json",{...report.identity,baseline:report.baseline,fixture:{huntsPerAccount:100,savedItemsPerAccount:100,queuedJobs:0,queuedJobsGate:"UNAVAILABLE: no shipped queue",seed:"One real HTTP finished hunt; transactionally cloned synthetic finished rows and immutable items; seed excluded"},metric:"Sequential authenticated HTTPS saved-page round trips, 20 items per page; browser-confirmed atomic erase POST",batches,eraseSamples,inventory,passed,exclusions:["installation","build","database/service startup","fixture seed","email-code authentication and confirmation preparation","10 warmup reads","external network"],loadAfter:os.loadavg(),limiter:"Unprofiled shared local runner; no throughput or speedup claim",fixedTwoVcpu:"UNTESTED",externalAcceptance:"UNTESTED"});
console.log(JSON.stringify({status:passed?"PASS_LOCAL_ONLY":"FAIL",evidence:report.root,readP95Ms:batches.map(batch=>batch.p95Ms),eraseMs:eraseSamples.map(sample=>sample.ms),jobs:0}));
if (!passed) process.exitCode=1;
