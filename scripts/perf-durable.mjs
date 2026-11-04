import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { withDatabase } from "./durable-database.mjs";
import { fixture, now } from "./durable-fixture.mjs";
const evidence=path.join(os.homedir(),"tmp/scoat-delivery/p04","perf-"+Date.now());
await fs.mkdir(evidence,{recursive:true});
await fs.writeFile(path.join(evidence,"baseline.json"),JSON.stringify({head:"73229775f35ec83e4e7f4208f82b681e2280ce81",status:"UNAVAILABLE",reason:"P03 HuntStore and Hunts.run throw not implemented; no durable record/inspect metric",ratio:null}));
const batches=[];
await withDatabase(async databaseUrl=>{
 const f=await fixture(databaseUrl);
 try {
   const views=[];
   for(let i=0;i<100;i++) views.push(await f.start());
   const samples=async batch=>{
     const operations=[];
     await Promise.all(Array.from({length:8},async (_,client)=>{
       for(let index=client;index<100;index+=8) {
         const view=views[index];
         const command=f.record(view,0);
         const begin=performance.now();
         const result=await f.run(command);
         operations.push({client,hunt:view.hunt,op:"record",ms:performance.now()-begin});
         assert(result.ok);
         const at=performance.now();
         const inspected=await f.hunts.view({account:f.scope,hunt:view.hunt,now});
         operations.push({client,hunt:view.hunt,op:"inspect",ms:performance.now()-at});
         assert(inspected.ok);
         assert.deepEqual(inspected.value,result.value.view);
         const row=inspected.value.rows.find(r=>r.row.id===command.row);
         assert.equal(row.revision,batch+1);
         views[index]=inspected.value;
       }
     }));
     assert.equal(operations.length,200);
     return operations;
   };
   await samples(0);
   for(let batch=1;batch<=5;batch++) {
     const operations=await samples(batch);
     const p95Ms=[...operations.map(o=>o.ms)].sort((a,b)=>a-b)[189];
     batches.push({batch,operations,p95Ms});
   }
   const commands=(await f.store.pool.query("SELECT count(*) FROM hunt_receipts WHERE account=$1 AND incarnation=$2",[f.scope.account,f.scope.incarnation])).rows[0].count;
   assert.equal(Number(commands),700);
   const foreign=await f.store.createAccount("perf-foreign-"+Date.now());
   assert.equal((await f.run({op:"read",hunt:views[0].hunt},{...f.agent,...foreign})).error.code,"missing");
   assert.equal(f.store.retries,0);
   const version=(await f.store.pool.query("SHOW server_version")).rows[0].server_version;
   const report={head:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),status:execFileSync("git",["status","--porcelain"],{encoding:"utf8"}),version,fixture:"synthetic-gap-record-inspect",hunts:100,clients:8,batches,committedCommands:Number(commands),conflicts:0,retries:f.store.retries,loss:0,duplicates:0,crossAccountReads:0,runner:{node:process.version,cpu:os.cpus()[0]?.model,cpus:os.availableParallelism(),platform:os.platform(),arch:os.arch()},metric:"DB command plus single-statement snapshot, projection, receipt and commit; inspect includes account/hunt fences",limiter:"Not profiled; absolute latency gate only, no speedup claim",excluded:["setup","install","100 starts","one warmup batch","unrelated network"],fixedTwoVcpu:"UNTESTED on this host",baseline:"UNAVAILABLE; baseline.json"};
   await fs.writeFile(path.join(evidence,"perf.json"),JSON.stringify(report,null,2));
   assert(batches.every(b=>b.p95Ms<=500),"p95 exceeds 500ms");
 } finally {await f.store.close();}
});
console.log(JSON.stringify({evidence,p95Ms:batches.map(b=>b.p95Ms)}));
