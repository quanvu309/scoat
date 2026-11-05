import { checkCardBuild, checkCardRouting, checkCardRenewal, checkCardProjection, checkCardInitialState } from "../scripts/check-card.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
test("a card opened on a finished hunt states its final result without polling", async () => {
 const calls=[];
 const bridge={capability:async op=>{calls.push(op);throw new Error("unexpected");},read:async()=>{calls.push("read");throw new Error("unexpected");},openLink:async()=>{}};
 const finished=cardSnapshot();finished.value.view.final={kind:"finished",quote:null};
 const changes=[];
 const controller=createController(finished,bridge,state=>changes.push(state));
 try {
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual(calls,[]);
  assert.equal(controller.getState().message,"Finished result. It no longer changes, so the card does not poll.");
  assert.ok(changes.every(state=>state.message!=="Connecting…"));
 } finally { controller.dispose(); }
});
import { createController, compareViews } from "../dist/card/index.js";
import { snapshotSchema, capabilitySchema, CardFailure } from "../dist/card/contracts.js";
import { checkComments } from "../scripts/check-no-comments.mjs";
import { checkSdkImports } from "../scripts/check-structure.mjs";
import { cardSnapshot } from "./fixtures/card.mjs";
import { CardTransport } from "../dist/card/adapter.js";
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
test("lost renewal response reopens through the authenticated session instead of reusing a superseded grant",async()=>{
 const s=setup();await flush();
 let rotated=false;
 s.bridge.capability=async(op,hunt,grant)=>{
  s.calls.push({op,hunt,grant});
  if(op==="renew") {
   if(rotated) throw new CardFailure("revoked");
   rotated=true;throw new Error("Renewal committed but response lost");
  }
  return {grant:"synthetic-reopened-secret",expiresAt:new Date(601000).toISOString()};
 };
 s.advance(301000);await flush();
 assert.equal(s.controller.getState().status,"stale");
 s.advance(6000);await flush();
 assert.equal(s.controller.getState().status,"live");
 assert.deepEqual(s.calls.map(call=>call.op),["open","read","renew","open","read"]);
 assert.equal(s.calls.at(-1).grant,"synthetic-reopened-secret");
 s.controller.dispose();
});
test("renewal guard rejects reuse of a possibly superseded capability",()=>{
 const source=readFileSync("src/card/index.ts","utf8");
 checkCardRenewal(source);
 assert.throws(()=>checkCardRenewal(source.replace("capability=undefined;\n    capability=await","capability=await")),/Discard the prior/);
 assert.throws(()=>checkCardRenewal(source.replace("capability=undefined;\n    capability=await","if(false) capability=undefined;\n    capability=await")),/Discard the prior/);
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
 const manifest=JSON.parse(readFileSync("package.json","utf8"));
 assert.doesNotThrow(()=>checkCardBuild(config,adapter,manifest));
 for(const vite of ["6.4.1","6.4.2","6.4.3","6.4.4"]) assert.throws(()=>checkCardBuild(config,adapter,{...manifest,devDependencies:{...manifest.devDependencies,vite}}),/Pin the verified Vite/);
 assert.throws(()=>checkCardBuild(config.replace("emptyOutDir:false","emptyOutDir:true"),adapter),/Preserve emitted/);
 assert.throws(()=>checkCardBuild(config,'import {PostMessageTransport} from "@modelcontextprotocol/ext-apps"'),/logs secrets/);
 assert.throws(()=>checkCardBuild(config,'console.debug("message", secret)'),/out of logs/);
 assert.throws(()=>checkCardBuild(config,adapter.replace("if(event.source!==this.source) return;","")),/Reject foreign message sources/);
 assert.throws(()=>checkCardBuild(config,adapter.replace("if(event.source!==this.source)","if(false && event.source!==this.source)")),/Reject foreign message sources/);
 assert(readFileSync("dist/card/index.html").byteLength>10000);
 assert.equal(typeof createController,"function");
});

test("transport dispatches only valid messages from its configured source and detaches on close",async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,"window"),events=new EventTarget(),source={},other={},received=[];
 Object.defineProperty(globalThis,"window",{value:events,configurable:true});
 const transport=new CardTransport({postMessage(){}},source);
 const send=(sender,data)=>{const event=new Event("message");Object.defineProperties(event,{source:{value:sender},data:{value:data}});events.dispatchEvent(event);};
 try {
  transport.onmessage=message=>received.push(message);
  await transport.start();
  const message={jsonrpc:"2.0",method:"notifications/initialized"};
  send(other,message);send(source,{invalid:true});assert.deepEqual(received,[]);
  send(source,message);assert.deepEqual(received,[message]);
  await transport.close();send(source,message);assert.equal(received.length,1);
 } finally {
  await transport.close();
  if(previous)Object.defineProperty(globalThis,"window",previous);else delete globalThis.window;
 }
});

test("card verification routing rejects missing header selector index and driver",()=>{
 const skill=readFileSync(".agents/skills/verify-scoat/SKILL.md","utf8"),index=readFileSync(".agents/skills/verify-scoat/features/README.md","utf8"),driver=readFileSync("scripts/verify.mjs","utf8");
 const documentation={host:readFileSync("docs/host-support.md","utf8"),notes:readFileSync("docs/implementation-notes.md","utf8"),agents:readFileSync("AGENTS.md","utf8")};
 checkCardRouting(skill,index,driver,documentation);
 assert.throws(()=>checkCardRouting(skill.replace("P07 live card","card"),index,driver,documentation),/Route P07 live card/);
 assert.throws(()=>checkCardRouting(skill.replace("features/card.md","features/missing.md"),index,driver,documentation),/Route P07 live card/);
 assert.throws(()=>checkCardRouting(skill,index.replace("[live card](card.md)","card"),driver,documentation),/Route P07 live card/);
 assert.throws(()=>checkCardRouting(skill,index,driver.replace('process.argv[2] === "p07-card"','process.argv[2] === "missing"'),documentation),/Route P07 live card/);
 assert.throws(()=>checkCardRouting(skill,index,driver,{...documentation,host:documentation.host.replace("Fresh same-account browser Stop/Skip and atomic replay","Same-account browser Person confirmation and interactive controls")}),/Document the implemented/);
 assert.throws(()=>checkCardRouting(skill,index,driver,{...documentation,notes:documentation.notes.replace("**createController**","**mountCard**")}),/Document the implemented/);
 assert.throws(()=>checkCardRouting(skill,index+"Live shopping, watches and the live card remain outside the implemented surface.",driver,documentation),/Document the implemented/);
 assert.throws(()=>checkCardRouting(skill,index,driver,{...documentation,agents:documentation.agents.replace("\n| Card bundling","\n\n| Card bundling")}),/continuous Markdown table/);
 assert.throws(()=>checkCardRouting(skill,index,driver,{...documentation,agents:documentation.agents.replace("| Risk | Required fix | Enforcement and negative proof |\n| --- | --- | --- |", "| Risk | Required fix | Enforcement and negative proof |\n| Misplaced row | Fix | Proof |\n| --- | --- | --- |")}),/delimiter directly after the header/);
});

test("card projection retains slot proofs, finished quote and status details",()=>{
 const source=readFileSync("src/card/renderer.tsx","utf8");
 checkCardProjection(source);
 for(const path of ["slot.completion.proof","view.final.quote","value.steps","value.reason"]) assert.throws(()=>checkCardProjection(source.replaceAll(path,path+"Missing")),/Render slot proofs/);
});
test("a card opened on a finished hunt states the final result instead of connecting forever; the original shape fails", async () => {
 const calls=[];
 const bridge={capability:async op=>{calls.push(op);throw new Error("unexpected");},read:async()=>{calls.push("read");throw new Error("unexpected");},openLink:async()=>{}};
 const finished=cardSnapshot();finished.value.view.final={kind:"finished",quote:null};
 const changes=[];
 const controller=createController(finished,bridge,state=>changes.push(state));
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.deepEqual(calls,[]);
 assert.equal(controller.getState().message,"Finished result. It no longer changes, so the card does not poll.");
 assert.ok(changes.every(state=>state.message!=="Connecting…"));
 controller.dispose();
 const open=createController(cardSnapshot(),undefined,()=>{});
 assert.match(open.getState().message,/Live updates unavailable/);
 const index=readFileSync(new URL("../src/card/index.ts",import.meta.url),"utf8"),renderer=readFileSync(new URL("../src/card/renderer.tsx",import.meta.url),"utf8");
 const original=file=>execFileSync("git",["show","4a5f31a:"+file],{cwd:new URL("..",import.meta.url),encoding:"utf8"});
 assert.doesNotThrow(()=>checkCardInitialState(index,renderer));
 assert.throws(()=>checkCardInitialState(original("src/card/index.ts"),renderer),/initialState owner/);
 assert.throws(()=>checkCardInitialState(index,original("src/card/renderer.tsx")),/renderer derives/);
 assert.throws(()=>checkCardInitialState(index.replace('if(initial.value.view.final.kind==="finished") return','if(false) return'),renderer),/initialState owner/);
});
