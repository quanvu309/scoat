import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { priceQuotes, pickBest } from "../dist/hunt/pricing.js";
import { renderView } from "../dist/hunt/view.js";
import { fixture, offer, compatibility, gbp, viewArgs } from "../test/fixtures/hunt.mjs";
const base=fixture(); const offers=[], authorities=[];
for(let seller=0;seller<4;seller++) {
  const p=offer(`p${seller}`,"price",{seller:`seller-${seller}`,amount:gbp(10000+seller)});
  const d=offer(`d${seller}`,"delivery",{seller:p.seller,amount:gbp(0)});
  const benefits=Array.from({length:16},(_,i)=>offer(`b${seller}-${i}`,"discount",{seller:p.seller,adjustment:{kind:"fixed",amount:gbp(i+1)}}));
  offers.push(p,d,...benefits);
  for(let mask=1;mask<65536;mask++) {
    if(mask%7!==0 && mask!==65535) continue;
    authorities.push(compatibility(p,d,...benefits.filter((_,i)=>mask & 2**i)));
  }
}
const input={...base,offers,compatibility:authorities};
const run=()=>{ const quotes=priceQuotes(input); const view=renderView({...viewArgs(quotes),offers}); return {quotes,view}; };
function oracle() {
  const expected=[];
  for(let seller=0;seller<4;seller++) {
    let best=10000+seller;
    for(let mask=1;mask<65536;mask++) if(mask%7===0 || mask===65535) {
      let reduction=0;
      for(let i=0;i<16;i++) if(mask & 2**i) reduction+=i+1;
      best=Math.min(best,10000+seller-reduction);
    }
    expected.push(best);
  }
  return expected;
}
const expected=oracle();
for(let i=0;i<2;i++) run();
const batches=[];
for(let batch=0;batch<5;batch++) {
  const samples=[];
  for(let sample=0;sample<4;sample++) {
    const start=performance.now(); const result=run(); samples.push(performance.now()-start);
    assert.deepEqual(result.quotes.map(q=>q.guaranteed.amount.pence),expected);
    assert.equal(result.view.rows.length,8); assert.equal(pickBest(result.quotes).guaranteed.amount.pence,expected[0]);
  }
  batches.push(samples);
}
const excess=priceQuotes({...base,offers:[...offers.filter(o=>o.seller==="seller-0"),offer("excess","discount",{seller:"seller-0"})],compatibility:[]});
assert.match(excess[0].limitations[0],/16/); assert.equal(pickBest(excess),null);
const samples=batches.flat().sort((a,b)=>a-b),p95=samples[Math.ceil(samples.length*.95)-1];
const receipt={head:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),status:execFileSync("git",["status","--porcelain"],{encoding:"utf8"}),node:process.version,runner:{platform:os.platform(),architecture:os.arch(),cpus:os.cpus().length,availableParallelism:os.availableParallelism(),model:os.cpus()[0]?.model,load:os.loadavg()},fixture:{sellers:4,benefitsPerAnchor:16,offers:offers.length,compatibilitySets:authorities.length,possibleSubsetsPerAnchor:65536},batches,p95Ms:p95,correctnessOracle:expected,overLimit:"PASS",baseline:"865dc1a: priceQuotes unavailable; no ratio or equivalent timing",exclusions:"fixture setup, warmup, oracle/assertions, installation and I/O; timing includes evidence/authority parsing, subset selection and view rendering",fixedTwoVcpu:"UNTESTED",localAcceptance:p95<=1000?"PASS":"FAIL"};
const root=process.env.SCOAT_EVIDENCE_DIR??path.join(os.homedir(),"tmp/scoat-delivery/p03",`perf-${Date.now()}`);await fs.mkdir(root,{recursive:true});await fs.writeFile(path.join(root,"samples.json"),JSON.stringify(receipt,null,2));
process.stdout.write(JSON.stringify({evidence:root,p95Ms:p95,localAcceptance:receipt.localAcceptance,fixedTwoVcpu:receipt.fixedTwoVcpu})+"\n");
assert.ok(p95<=1000,`p95 ${p95} exceeds one second`);
