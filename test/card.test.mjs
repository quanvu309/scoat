import { checkCardBuild, checkCardRouting } from "../scripts/check-card.mjs";
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { createController, compareViews } from "../dist/card/index.js";
import { snapshotSchema, capabilitySchema, CardFailure } from "../dist/card/contracts.js";
import { checkComments } from "../scripts/check-no-comments.mjs";
import { checkSdkImports } from "../scripts/check-structure.mjs";
import { cardSnapshot } from "./fixtures/card.mjs";
const flush=async()=>{for(let i=0;i<10;i++) await Promise.resolve();};
function setup(read=async()=>cardSnapshot()) {
 let now=0, calls=[], timers=new Map(), changes=[];
 const clock={now:()=>now,set:(fn,ms)=>{const id=Symbol();timers.set(id,{fn,ms});return id;},clear:id=>timers.delete(id)};
 const bridge={async capability(op,hunt,grant){calls.push({op,hunt,grant});return {grant:op==="renew"?"synthetic-new-secret":"synthetic-secret",expiresAt:new Date(now+300000).toISOString()};},async read(hunt,grant){calls.push({op:"read",hunt,grant});return read();},async openLink(){}};
 const controller=createController(cardSnapshot(),bridge,state=>changes.push(state),clock);
 return {controller,calls,timers,changes,advance(ms){now+=ms;const next=[...timers.values()][0];timers.clear();next?.fn();},bridge};
}
test("strict canonical and bridge boundaries reject forged fields and unsafe links",()=>{
 const snapshot=cardSnapshot();assert.equal(snapshotSchema.parse(snapshot).value.view.hunt,snapshot.value.view.hunt);
 assert.throws(()=>snapshotSchema.parse({...snapshot,authority:"person"}));
 assert.throws(()=>snapshotSchema.parse({...snapshot,controls:{...snapshot.controls,stop:"javascript:alert(1)"}}));
 assert.throws(()=>snapshotSchema.parse({...snapshot,value:{view:{...snapshot.value.view,person:true}}}));
 assert.throws(()=>capabilitySchema.parse(undefined));
});
test("row vectors reject dominated, incomparable, foreign and irreversible regressions",()=>{
 const a=cardSnapshot().value.view,b=structuredClone(a);b.rows[0].revision=2;
 assert.equal(compareViews(b,a),"drop");
 const c=structuredClone(a);c.rows[1].revision=2;assert.equal(compareViews(b,c),"retry");
 assert.equal(compareViews(a,{...b,hunt:"foreign"}),"drop");
 assert.equal(compareViews({...b,stopRequested:true},b),"drop");
 b.rows[0].skippedBy="person";const late=structuredClone(b);late.rows[0].skippedBy=null;assert.equal(compareViews(b,late),"drop");
 assert.equal(compareViews({...a,final:{kind:"finished",quote:null}},b),"drop");
});
test("one flight, hidden and disposed issue zero requests; disposed replies never render",async()=>{
 let resolve;const pending=new Promise(done=>{resolve=done;});const s=setup(()=>pending);await flush();
 await s.controller.refresh();assert.equal(s.calls.length,2);
 s.controller.setVisible(false);const before=s.calls.length;s.advance(9000);assert.equal(s.calls.length,before);
 const changes=s.changes.length;s.controller.dispose();resolve(cardSnapshot());await flush();assert.equal(s.changes.length,changes);assert.equal(s.timers.size,0);
});
test("hidden resume renews expired grants before read and rotates the secret",async()=>{
 const s=setup();await flush();s.controller.setVisible(false);const before=s.calls.length;s.advance(301000);assert.equal(s.calls.length,before);s.controller.setVisible(true);await flush();
 assert.deepEqual(s.calls.map(c=>c.op),["open","read","renew","read"]);assert.equal(s.calls.at(-1).grant,"synthetic-new-secret");s.controller.dispose();
});
test("outage remains recoverable after expiry; revoked access ends polling",async()=>{
 let failure=true;const s=setup(async()=>{if(failure) throw new Error("database offline");return cardSnapshot();});await flush();assert.equal(s.controller.getState().status,"stale");assert.equal(s.timers.size,1);
 failure=false;s.advance(301000);await flush();assert.equal(s.controller.getState().status,"live");assert.deepEqual(s.calls.map(c=>c.op),["open","read","renew","read"]);s.controller.dispose();
 const revoked=setup(async()=>{throw new CardFailure("revoked");});await flush();assert.equal(revoked.controller.getState().status,"revoked");assert.equal(revoked.timers.size,0);const count=revoked.calls.length;revoked.controller.setVisible(true);await flush();assert.equal(revoked.calls.length,count);revoked.controller.dispose();
});
test("persistent stale vectors have a normal timer; finished and unsupported never poll",async()=>{
 const old=cardSnapshot();old.value.view.rows[0].revision=0;const initial=cardSnapshot();initial.value.view.rows[0].revision=2;
 let reads=0;const bridge={capability:async()=>({grant:"synthetic",expiresAt:new Date(Date.now()+300000).toISOString()}),read:async()=>{reads++;return old;},openLink:async()=>{}};
 const tasks=[];const c=createController(initial,bridge,()=>{},{now:Date.now,set:(fn,ms)=>{tasks.push(ms);return 1;},clear:()=>{}});await flush();assert.equal(reads,1);assert.deepEqual(tasks,[3000]);c.dispose();
 initial.value.view.final={kind:"finished",quote:null};const done=createController(initial,bridge,()=>{});await flush();assert.equal(reads,1);done.dispose();
 const unsupported=createController(cardSnapshot(),undefined,()=>{});assert.equal(unsupported.getState().status,"unsupported");unsupported.dispose();
});
test("parsers reject TSX CSS HTML comments and SDK imports in TSX domain",()=>{
 for(const [file,source] of [["a.tsx","const a=<div/>; /* forbidden */"],["a.css","a{/* forbidden */color:red}"],["a.html","<!doctype html><!-- forbidden --><p>Hello</p>"],["a.html","<script>/* forbidden */</script>"],["a.html","<style>/* forbidden */</style>"]]) assert.throws(()=>checkComments(file,source));
 assert.throws(()=>checkSdkImports("src/hunt/unsafe.tsx",'import {App} from "@modelcontextprotocol/ext-apps"; const x=<div/>;'));
});

test("bundle preserves node controller and transport never logs grant messages",()=>{
 const config=readFileSync("vite.config.ts","utf8"),adapter=readFileSync("src/card/adapter.ts","utf8");
 assert.doesNotThrow(()=>checkCardBuild(config,adapter));
 assert.throws(()=>checkCardBuild(config.replace("emptyOutDir:false","emptyOutDir:true"),adapter),/Preserve emitted/);
 assert.throws(()=>checkCardBuild(config,'import {PostMessageTransport} from "@modelcontextprotocol/ext-apps"'),/logs secrets/);
 assert.throws(()=>checkCardBuild(config,'console.debug("message", secret)'),/out of logs/);
 assert(readFileSync("dist/card/index.html").byteLength>10000);
 assert.equal(typeof createController,"function");
});

test("card verification routing rejects missing header selector index and driver",()=>{
 const skill=readFileSync(".agents/skills/verify-scoat/SKILL.md","utf8"),index=readFileSync(".agents/skills/verify-scoat/features/README.md","utf8"),driver=readFileSync("scripts/verify.mjs","utf8");
 checkCardRouting(skill,index,driver);
 assert.throws(()=>checkCardRouting(skill.replace("P07 live card","card"),index,driver));
 assert.throws(()=>checkCardRouting(skill.replace("features/card.md","features/missing.md"),index,driver));
 assert.throws(()=>checkCardRouting(skill,index.replace("[live card](card.md)","card"),driver));
 assert.throws(()=>checkCardRouting(skill,index,driver.replace('process.argv[2] === "p07-card"','process.argv[2] === "missing"')));
});
