import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { withDatabase } from "./durable-database.mjs";
import { fixture, gate, offer, proof, now, intent } from "./durable-fixture.mjs";
import { PostgresHuntStore } from "../dist/hunt/postgres.js";
import { Hunts } from "../dist/hunt/index.js";
const evidence = path.join(os.homedir(),"tmp/scoat-delivery/p04","verify-" + Date.now());
await fs.mkdir(evidence,{recursive:true});
const transcript=[];
const contention=[];
const lanes=[];
const passed = name => { lanes.push({ name,status:"PASS" }); console.log(JSON.stringify({lane:name,status:"PASS"})); };
await withDatabase(async databaseUrl => {
 const database=async args=>promisify(execFile)(process.execPath,["scripts/database.mjs",...args],{env:{...process.env,DATABASE_URL:databaseUrl},timeout:10000});
 await database(["migrate"]);
 await database(["migrate"]);
 const seed=await database(["seed","--fixture","p04-migration"]);
 assert.equal((await database(["seed","--fixture","p04-migration"])).stdout,seed.stdout);
 const f=await fixture(databaseUrl);
 const {store,hooks,run,start,record,control}=f;
 const found = () => { const {id,row,...input}=offer("discarded","price",{amount:{currency:"GBP",pence:7000}}); return {kind:"found",offers:[input]}; };
 async function proveContention(scope,client) {
   const prefix=[scope.account,scope.incarnation];
   const probes=scope.accountFence==="exclusive"
     ? [{lock:"account",sql:"SELECT account FROM hunt_accounts WHERE account=$1 AND incarnation=$2 FOR UPDATE NOWAIT",args:prefix}]
     : [{lock:"hunt",sql:"SELECT id FROM durable_hunts WHERE account=$1 AND incarnation=$2 AND id=$3 FOR " + (scope.huntFence==="exclusive"?"UPDATE":"SHARE") + " NOWAIT",args:[...prefix,scope.hunt]},
        ...scope.rows.map(row=>({lock:"row",sql:"SELECT id FROM hunt_rows WHERE account=$1 AND incarnation=$2 AND hunt=$3 AND id=$4 FOR UPDATE NOWAIT",args:[...prefix,scope.hunt,row]}))];
   await client.query("SAVEPOINT contention_probe");
   let blocked=null;
   try {
     for (const probe of probes) {
       try { await client.query(probe.sql,probe.args); }
       catch (error) { if(error.code!=="55P03")throw error; blocked={lock:probe.lock,code:error.code,request:scope.request?.key??"erase"}; break; }
     }
   } finally {
     await client.query("ROLLBACK TO SAVEPOINT contention_probe");
     await client.query("RELEASE SAVEPOINT contention_probe");
   }
   assert(blocked,"Contender must encounter a PostgreSQL lock conflict before releasing its holder");
   contention.push(blocked);
 }
 async function heldRace(first,second,check,disjoint=false) {
   const held=gate(),release=gate(),entered=gate();
   let firstKey;
   let accountEntries=0;
   hooks.afterRowFence=async scope => { if (scope.request?.key===firstKey) { held.resolve(); await release.promise; } else if (disjoint) entered.resolve(); };
   hooks.afterAccountFence=async (scope,client) => { if (!disjoint && ++accountEntries===2) { await proveContention(scope,client); entered.resolve(); } };
   const a=first(); firstKey=a.key;
   const pa=a.run();

   try {
     await held.promise;

     const pb=second();
     await entered.promise;

     release.resolve();
     const results=await Promise.all([pa,pb]);
     transcript.push(results);
     await check(results);
   } finally { release.resolve(); delete hooks.afterRowFence; delete hooks.afterAccountFence; }
 }
 try {
   const initialize={op:"start",requestKey:randomUUID(),intent:(await import("./durable-fixture.mjs")).intent,profile:null};
   const initialized=await run(initialize); assert(initialized.ok);
   const availableRead=f.deps.knowledge.read;
   f.deps.knowledge.read=async()=>{throw new Error("Knowledge unavailable after original start");};
   try { assert.deepEqual(await run(initialize),initialized); }
   finally { f.deps.knowledge.read=availableRead; }
   let view=initialized.value.view;
   const cmd=record(view);
   const reply=await run(cmd); assert(reply.ok); assert.equal(reply.value.view.rows.find(r=>r.row.id===cmd.row).revision,1);
   const restartRead=async expected=>{
     const source = 'import { Hunts } from "./dist/hunt/index.js"; import { PostgresHuntStore } from "./dist/hunt/postgres.js"; const input=JSON.parse(process.env.SCOAT_RESTART_INPUT); const store=new PostgresHuntStore({databaseUrl:input.databaseUrl}); try { const hunts=new Hunts({store}); process.stdout.write(JSON.stringify(await hunts.run({agent:input.agent,request:{op:"read",hunt:input.hunt},now:input.now}))); } finally { await store.close(); }';
     const child=await promisify(execFile)(process.execPath,["--input-type=module","-e",source],{env:{...process.env,SCOAT_RESTART_INPUT:JSON.stringify({databaseUrl,agent:f.agent,hunt:view.hunt,now})},timeout:10000});
     assert.deepEqual(JSON.parse(child.stdout),expected);
     transcript.push({processRestartRead:JSON.parse(child.stdout)});
   };
   await restartRead(reply);
   const restartedStore=new PostgresHuntStore({databaseUrl});
   try {
   const reloaded=new Hunts({...f.deps,store:restartedStore});
   assert.deepEqual(await reloaded.run({agent:f.agent,request:{op:"read",hunt:view.hunt},now}),reply);
   for (const row of reply.value.view.rows) for (const slot of row.slots) {
      const current=(await run({op:"read",hunt:view.hunt})).value.view;
      const r=current.rows.find(r=>r.row.id===row.row.id);
      assert((await run({op:"record",requestKey:randomUUID(),hunt:view.hunt,row:r.row.id,slot:slot.slot,expected:r.revision,outcome:{kind:"gap",reason:"Synthetic gap"}})).ok);
   }
   const finished=await run({op:"finish",requestKey:randomUUID(),hunt:view.hunt,selection:null}); assert(finished.ok);
   assert.deepEqual((await reloaded.run({agent:f.agent,request:{op:"read",hunt:view.hunt},now})),finished);
   await restartRead(finished);
   assert.equal((await run(record(finished.value.view))).error.code,"conflict");
   } finally { await restartedStore.close(); }
   passed("start-record-finish survives process restart");
   let unspecified=await run({op:"start",requestKey:randomUUID(),intent:{...intent,shop:null},profile:null});
   assert(unspecified.ok);
   let inferred=unspecified.value.view;
   for (const row of inferred.rows) for (const slot of row.slots) {
     const current=inferred.rows.find(r=>r.row.id===row.row.id);
     const offers=["price","delivery"].map(kind=>{const {id,row,...input}=offer("discarded",kind,{amount:{currency:"GBP",pence:kind==="price"?7000:0}});return input;});
     const outcome=row.row.place==="shop-price"?{kind:"found",offers}:row.row.place==="other-sellers"?{kind:"none",checked:"Synthetic other seller checked",seller:"seller-"+slot.slot,proof:[proof]}:{kind:"gap",reason:"Synthetic unavailable"};
     unspecified=await run({op:"record",requestKey:randomUUID(),hunt:inferred.hunt,row:current.row.id,slot:slot.slot,expected:current.revision,outcome});
     assert(unspecified.ok); inferred=unspecified.value.view;
   }
   assert.equal(inferred.progress.resolved,inferred.progress.total);
   assert.equal(inferred.directive.kind,"finish");
   const inferredFinish=await run({op:"finish",requestKey:randomUUID(),hunt:inferred.hunt,selection:null});
   assert(inferredFinish.ok); assert.equal(inferredFinish.value.view.final.kind,"finished");
   transcript.push({inferredShop:inferred,inferredFinish});
   passed("unspecified shop shares the rendered finish decision");
   view=await start();
   const a=record(view,0),b=record(view,1);
   await heldRace(()=>({key:a.requestKey,run:()=>run(a)}),()=>run(b),async replies=>{assert(replies.every(r=>r.ok));const read=await run({op:"read",hunt:view.hunt});assert.equal(read.value.view.rows.filter(r=>r.revision===1).length,2);},true);
   passed("disjoint rows apply while first row remains locked");
   view=await start();
   const c=record(view,0,{outcome:found()}),d=record(view,0,{outcome:found()});
   await heldRace(()=>({key:c.requestKey,run:()=>run(c)}),()=>run(d),async replies=>{assert.equal(replies.filter(r=>r.ok).length,1);assert.equal(replies[1].error.code,"conflict");assert.equal(replies[1].current.offers.length,1);assert.deepEqual(replies[1].current,replies[0].value.view);});
   passed("same row CAS one winner");
   view=await start(); const identical=record(view);
   await heldRace(()=>({key:identical.requestKey,run:()=>run(identical)}),()=>run(identical),async ([a,b])=>{assert.deepEqual(a,b);assert.equal(JSON.stringify(a),JSON.stringify(b));});
   assert.equal((await store.pool.query("SELECT count(*) FROM hunt_receipts WHERE account=$1 AND incarnation=$2 AND key=$3",[f.scope.account,f.scope.incarnation,identical.requestKey])).rows[0].count,"1");
   passed("concurrent identical key one effect and exact reply");
   const before=await run({op:"read",hunt:view.hunt});
   assert.equal((await run({...identical,outcome:{kind:"gap",reason:"Different"}})).error.code,"key-reused");
   assert.deepEqual(await run({op:"read",hunt:view.hunt}),before);
   passed("key payload mismatch unchanged");
   const originalReply=await run(identical);
   const changed=await run(record(originalReply.value.view,1));
   assert(changed.ok);
   assert.deepEqual(await run(identical),originalReply);
   assert.notDeepEqual(await run({op:"read",hunt:view.hunt}),originalReply);
   passed("old replay returns original receipt after newer independent write");

   view=await start(); const skipKey=randomUUID();
   await heldRace(()=>({key:skipKey,run:()=>control(view,{kind:"skip",row:view.rows[0].row.id},skipKey)}),()=>run(record(view,0,{outcome:found()})),async ([a,b])=>{assert(a.ok);assert.equal(b.error.code,"conflict");});
   passed("sticky Skip serializes found");
   view=await start();
   assert.equal((await run({op:"finish",requestKey:randomUUID(),hunt:view.hunt,selection:null})).error.code,"incomplete");
   const targetRow=view.rows[0].row.id;
   const targetSlot=view.rows[0].slots[0].slot;
   for(const row of view.rows) for(const slot of row.slots) if(row.row.id!==targetRow || slot.slot!==targetSlot) {
     const latest=(await run({op:"read",hunt:view.hunt})).value.view;
     const r=latest.rows.find(r=>r.row.id===row.row.id);
     assert((await run({op:"record",requestKey:randomUUID(),hunt:view.hunt,row:r.row.id,slot:slot.slot,expected:r.revision,outcome:{kind:"gap",reason:"Synthetic gap"}})).ok);
   }
   view=(await run({op:"read",hunt:view.hunt})).value.view;
   const rec=record(view);
   await heldRace(()=>({key:rec.requestKey,run:()=>run(rec)}),()=>run({op:"finish",requestKey:randomUUID(),hunt:view.hunt,selection:null}),async ([a,b])=>{assert(a.ok);assert(b.ok);assert.equal(b.value.view.final.kind,"finished");assert.equal(b.value.view.rows[0].revision,a.value.view.rows[0].revision);});
   passed("finish racing unresolved record has legal result");
   view=await start(); view=(await run(record(view,0,{outcome:found()}))).value.view; const stopKey=randomUUID();
   await heldRace(()=>({key:stopKey,run:()=>control(view,{kind:"stop"},stopKey)}),()=>run(record(view,0,{outcome:found()})),async ([a,b])=>{assert(a.ok);assert.equal(b.error.code,"forbidden");});
   assert.equal((await run(record(view,0,{outcome:found()}))).error.code,"forbidden");
   assert((await run(record(view,0,{outcome:{kind:"gap",reason:"Repair after Stop"}}))).ok);
   passed("Stop rejects found and correction but permits named gap");
   const foreign=await store.createAccount("foreign-"+randomUUID());
   assert.equal((await run({op:"read",hunt:view.hunt},{...f.agent,...foreign})).error.code,"missing");
   assert.equal((await run(record(view),{...f.agent,...foreign})).error.code,"missing");
   passed("cross account guessed reads and writes hidden");
   view=await start();
   let current=(await run(record(view,0,{outcome:{kind:"none",checked:"Checked synthetic official page; no offer",proof:[proof]}}))).value.view;
   assert.equal(current.rows.find(r=>r.row.id===view.rows[0].row.id).slots[0].completion.checked,"Checked synthetic official page; no offer");
   const inputs=["price","delivery","discount","cashback"].map(kind=>{const {id,row,...input}=offer("discard",kind,kind==="price"?{amount:{currency:"GBP",pence:7000}}:kind==="delivery"?{amount:{currency:"GBP",pence:0}}:kind==="cashback"?{amount:{currency:"GBP",pence:100},programme:"Synthetic"}:{});return input;});
   current=(await run(record(current,0,{outcome:{kind:"found",offers:inputs}}))).value.view;
   const ids=current.offers.map(o=>o.id);
   const compat=await run({op:"compatibility",requestKey:randomUUID(),hunt:view.hunt,evidence:{offers:ids,proof:[proof]}}); assert(compat.ok);
   assert(compat.value.view.quotes.some(q=>q.selection.benefits.length===2));
   const staleRead=await f.hunts.run({agent:f.agent,request:{op:"read",hunt:view.hunt},now:"2026-11-06T12:00:00Z"});
   assert(staleRead.ok); assert.equal(staleRead.value.view.quotes.length,0); assert.equal(staleRead.value.view.offers.length,4); assert(staleRead.value.view.gaps.some(g=>g.includes("no longer current")));
   const selectedView=await start();
   let selected=(await run(record(selectedView,0,{outcome:{kind:"found",offers:inputs}}))).value.view;
   const selectedIds=selected.offers.map(o=>o.id);
   assert((await run({op:"compatibility",requestKey:randomUUID(),hunt:selected.hunt,evidence:{offers:selectedIds,proof:[proof]}})).ok);
   for(const r of selected.rows) for(const slot of r.slots) if(slot.completion.kind==="pending") {
      const latest=(await run({op:"read",hunt:selected.hunt})).value.view;
      const target=latest.rows.find(row=>row.row.id===r.row.id);
      assert((await run({op:"record",requestKey:randomUUID(),hunt:selected.hunt,row:r.row.id,slot:slot.slot,expected:target.revision,outcome:{kind:"gap",reason:"Synthetic named gap"}})).ok);
   }
   const selection={price:selected.offers.find(o=>o.kind==="price").id,delivery:selected.offers.find(o=>o.kind==="delivery").id,benefits:selected.offers.filter(o=>!["price","delivery"].includes(o.kind)).map(o=>o.id)};
   const selectedFinish=await run({op:"finish",requestKey:randomUUID(),hunt:selected.hunt,selection});
   assert(selectedFinish.ok);
   assert.equal(selectedFinish.value.view.final.quote.guaranteed.amount.pence,6900);
   assert.equal(selectedFinish.value.view.final.quote.backLater[0].value.pence,100);
   transcript.push({supportedSelection:selectedFinish});
   current=(await run(record(current,0,{outcome:{kind:"gap",reason:"Correction"}}))).value.view;
   assert.equal(current.offers.length,0);
   assert.equal((await store.pool.query("SELECT count(*) FROM hunt_compatibility WHERE account=$1 AND incarnation=$2 AND hunt=$3",[f.scope.account,f.scope.incarnation,view.hunt])).rows[0].count,"0");
   assert.equal((await run({op:"compatibility",requestKey:randomUUID(),hunt:view.hunt,evidence:{offers:ids,proof:[proof]}})).error.code,"unproven");
   passed("none proofs, supported full set and correction invalidation");
   const retryView=await start();
   const retryCommand=record(retryView);
   let attempts=0;
   hooks.beforeCommit=async scope=>{if(scope.request?.key===retryCommand.requestKey && attempts++===0) throw Object.assign(new Error("Injected database retry"),{code:"40P01"});};
   assert((await run(retryCommand)).ok);
   assert.equal(attempts,2);
   assert.equal(store.retries,1);
   delete hooks.beforeCommit;
   const exhausted=record((await run({op:"read",hunt:retryView.hunt})).value.view);
   let failedAttempts=0;
   hooks.beforeCommit=async scope=>{if(scope.request?.key===exhausted.requestKey){failedAttempts++;throw Object.assign(new Error("Injected serialization exhaustion"),{code:"40001"});}};
   await assert.rejects(run(exhausted),/serialization exhaustion/);
   delete hooks.beforeCommit;
   assert.equal(failedAttempts,3);
   assert.equal((await store.pool.query("SELECT count(*) FROM hunt_receipts WHERE account=$1 AND incarnation=$2 AND key=$3",[f.scope.account,f.scope.incarnation,exhausted.requestKey])).rows[0].count,"0");
   assert.equal((await run({op:"read",hunt:retryView.hunt})).value.view.rows[0].revision,1);
   passed("bounded deadlock and serialization retries roll back atomically");
   const heldWriter=gate(),releaseWriter=gate(),eraseEntered=gate();
   const precommitKey=randomUUID();
   hooks.beforeCommit=async scope=>{if(scope.request?.key===precommitKey){heldWriter.resolve();await releaseWriter.promise;}};
   hooks.beforeAccountFence=async (scope,client)=>{if(scope.accountFence==="exclusive"){await proveContention(scope,client);eraseEntered.resolve();}};
   const writer=run(record(current,0,{requestKey:precommitKey}));
   await heldWriter.promise;
   const erasing=f.erase({account:f.scope});
   await eraseEntered.promise;
   releaseWriter.resolve();
   assert((await writer).ok);
   await erasing;
   delete hooks.beforeCommit;
   delete hooks.beforeAccountFence;
   assert.equal((await run(record(view,0,{requestKey:precommitKey}))).error.code,"forbidden");
   passed("erasure waits for paused precommit writer then removes its effect");
   const freshScope=await store.createAccount(f.scope.account);
   Object.assign(f.agent,freshScope);
   Object.assign(f.person,freshScope);
   Object.assign(f.scope,freshScope);
   view=await start();
   const paused=gate(),resume=gate(),oldKey=randomUUID();
   hooks.beforeAccountFence=async scope=>{if(scope.request?.key===oldKey){paused.resolve();await resume.promise;}};
   const old=run(record(view,0,{requestKey:oldKey}));
   await paused.promise;
   await f.erase({account:f.scope});
   resume.resolve();
   assert.equal((await old).error.code,"forbidden");
   delete hooks.beforeAccountFence;
   assert.equal((await run(identical)).error.code,"forbidden");
   assert.equal((await run({op:"start",requestKey:randomUUID(),intent:view.intent,profile:null})).error.code,"forbidden");
   assert.equal((await run({op:"list"})).error.code,"forbidden");
   assert.equal((await f.hunts.inspect({person:f.person,hunt:view.hunt,now})).error.code,"forbidden");
   assert.equal((await f.hunts.finished({account:f.scope,hunt:view.hunt})).error.code,"forbidden");
   assert.equal((await control(view,{kind:"stop"})).error.code,"forbidden");

   passed("erasure fences paused writer, delayed receipt and initialization");
   const incarnation=await store.createAccount(f.scope.account); assert.notEqual(incarnation.incarnation,f.scope.incarnation);
   transcript.push({finalReceipts:lanes});
   const version=(await store.pool.query("SHOW server_version")).rows[0].server_version;
   await fs.writeFile(path.join(evidence,"proof.json"),JSON.stringify({head:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),status:execFileSync("git",["status","--porcelain"],{encoding:"utf8"}),version,lanes,transcript,contention,retries:store.retries,realSessions:"UNTESTED: ten model-agent/real-host sessions unavailable"},null,2));
 } finally { await store.close(); }
}).catch(async error=>{await fs.writeFile(path.join(evidence,"failure.json"),JSON.stringify({head:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),lanes,status:"FAIL",error:String(error),transcript},null,2));throw error;});
console.log(JSON.stringify({evidence,lanes}));
