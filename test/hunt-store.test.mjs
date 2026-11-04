import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkDurableFences, checkStartReplay, checkDurableCommands, checkRaceBarriers, checkTransactionGuidance } from "../scripts/check-structure.mjs";
import { canonical, digest } from "../dist/hunt/postgres.js";
import { huntInput } from "../dist/mcp/index.js";
test("durable fences reject original lockAll shape and serializable prescription",()=>{
 const actual=fs.readFileSync("src/hunt/postgres.ts","utf8");
 checkDurableFences(actual);
 assert.throws(()=>checkDurableFences("transact(args: { hunt: HuntId | null; lockAll: boolean })"));
 assert.throws(()=>checkDurableFences(actual.replace("READ COMMITTED","SERIALIZABLE")));
});
test("canonical payload binds object keys independently of input insertion order",()=>{
 assert.equal(canonical({b:1,a:[2,3]}),canonical({a:[2,3],b:1}));
 assert.equal(digest({a:1,b:2}),digest({b:2,a:1}));
 assert.notEqual(digest({a:[1,2]}),digest({a:[2,1]}));
});
test("compatibility transport rejects unbound proofs, empty evidence and manufactured observations",()=>{
 assert.equal(huntInput.safeParse({op:"compatibility",requestKey:"k",hunt:"h",evidence:{offers:["server-id"],proof:[]}}).success,false);
 assert.equal(huntInput.safeParse({op:"compatibility",requestKey:"k",hunt:"h",stackProof:[]}).success,false);
 assert.equal(huntInput.safeParse({op:"record",requestKey:"k",hunt:"h",row:"r",slot:0,expected:0,outcome:{kind:"found",offers:[{id:"manufactured"}]}}).success,false);
});

test("start replay precedes external inputs and rejects the original prefetch shape",()=>{
 checkStartReplay(fs.readFileSync("src/hunt/index.ts","utf8"));
 assert.throws(()=>checkStartReplay('class Hunts { async run(request) { const start = request.op === "start" ? await this.deps.knowledge.read({release:"latest"}) : null; return this.execute(start); } }'),/fenced receipt/);
});

test("finish uses projected coverage and rejects the original nullable seller decision",()=>{
 checkDurableCommands(fs.readFileSync("src/hunt/index.ts","utf8"));
 assert.throws(()=>checkDurableCommands('function finish() { if (!finishable(view.rows,state.release,state.hunt.intent.shop).ok) return failure("incomplete"); }'),/canonical HuntView.progress/);
});

test("contended barriers prove database conflicts before signaling",()=>{
 checkRaceBarriers(fs.readFileSync("scripts/verify-durable.mjs","utf8"));
 assert.throws(()=>checkRaceBarriers('hooks.afterAccountFence=async scope => { if (!disjoint && ++accountEntries===2) entered.resolve(); };'),/Await proveContention/);
 assert.throws(()=>checkRaceBarriers('hooks.beforeAccountFence=async scope=>{if(scope.accountFence==="exclusive")eraseEntered.resolve();};'),/Await proveContention/);
});

test("transaction guidance rejects the superseded all-row locking prescription",()=>{
 checkTransactionGuidance(fs.readFileSync("RATIONALE.md","utf8"));
 assert.throws(()=>checkTransactionGuidance("Finish and stop take every row lock in one transaction."),/exclusive hunt fence/);
});
