import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hunts } from "../dist/hunt/index.js";
import { huntInput } from "../dist/mcp/index.js";
import { agentRequestKey } from "../dist/hunt/request-key.js";
import { checkControlPrerequisites } from "../scripts/check-structure.mjs";
import { intent, proof } from "./fixtures/hunt.mjs";

const requests=[
 {op:"start",profile:null,intent},
 {op:"record",hunt:"h",row:"r",slot:0,expected:0,outcome:{kind:"gap",reason:"Unavailable"}},
 {op:"compatibility",hunt:"h",evidence:{offers:["a","b"],proof:[proof]}},
 {op:"finish",hunt:"h",selection:null}
];
test("agent keys reserve the browser namespace including newline suffixes",()=>{
 for (const key of ["person:","person:nonce","person:\nnonce", "", "x".repeat(129)]) assert.equal(agentRequestKey.safeParse(key).success,false);
 for (const key of ["request-1","personal:nonce","PERSON:nonce"]) assert.equal(agentRequestKey.safeParse(key).success,true);
 for (const request of requests) {
  assert.equal(huntInput.safeParse({...request,requestKey:"agent-key"}).success,true);
  assert.equal(huntInput.safeParse({...request,requestKey:"person:nonce"}).success,false);
 }
});
test("direct agent requests reject reserved keys before store or knowledge access",async()=>{
 const forbidden=()=>{throw new Error("Reserved request reached a dependency");};
 const hunts=new Hunts({store:{transact:forbidden},knowledge:{read:forbidden},delivery:{}});
 for (const request of requests) {
  const result=await hunts.run({agent:{account:"a",incarnation:"i",kind:"agent",client:"test"},request:{...request,requestKey:"person:nonce"},now:"2026-11-04T00:00:00.000Z"});
  assert.equal(result.ok,false);
  assert.equal(result.error.code,"invalid");
 }
});
test("enforcement rejects missing and dead namespace guards and timestamp overwrite",()=>{
 const hunt=readFileSync("src/hunt/index.ts","utf8"),wire=readFileSync("src/mcp/index.ts","utf8");
 checkControlPrerequisites(hunt,wire);
 assert.throws(()=>checkControlPrerequisites(hunt,wire.replaceAll("requestKey: agentRequestKey","requestKey: id")),/live wire/);
 const guard='if ("requestKey" in request && !agentRequestKey.safeParse(request.requestKey).success) return failure("invalid", "Agent request key is invalid or reserved");';
 assert.throws(()=>checkControlPrerequisites(hunt.replace(guard,""),wire),/live wire/);
 assert.throws(()=>checkControlPrerequisites(hunt.replace(guard,`if (false) { ${guard} }`),wire),/live wire/);
 assert.throws(()=>checkControlPrerequisites(hunt.replace('if(state.hunt.stopRequestedAt === null) ',''),wire),/first accepted Stop/);
});
