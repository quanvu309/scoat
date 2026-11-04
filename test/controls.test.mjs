import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ControlCodec, verifiedControl } from "../dist/controls/codec.js";
import { Hunts } from "../dist/hunt/index.js";
import { checkBrowserControls, checkPublicAuthority, checkControlVerification, checkControlImports, checkHuntAuthority } from "../scripts/check-structure.mjs";
test("signed intents describe only; confirmations are strict frozen browser-bound authority",async()=>{
 const codec=new ControlCodec({version:1,keyId:"test",secret:"a".repeat(64)});
 const intent={account:randomUUID(),incarnation:randomUUID(),hunt:randomUUID(),action:{kind:"stop"}};
 assert.throws(()=>new ControlCodec({version:1,keyId:"test",secret:""}));
 assert.throws(()=>codec.intent({...intent,authority:true}));
 const signed=codec.intent(intent);assert.deepEqual(codec.readIntent(signed),intent);
 assert.throws(()=>codec.verify(signed,"browser",intent.action));
 assert.throws(()=>codec.issue({...intent,action:{kind:"hub"}},"browser",123456789));
 const issued=codec.issue(intent,"browser",123456789.125);
 const authority=codec.verify(issued.token,"browser",intent.action);
 assert.equal(verifiedControl(authority).deadline,123576789);
 assert(Object.isFrozen(verifiedControl(authority).intent));
 assert.throws(()=>codec.verify(issued.token,"wrong",intent.action));
 assert.throws(()=>codec.verify(issued.token,"browser",{kind:"skip",row:"x"}));
 assert.throws(()=>new ControlCodec({version:1,keyId:"rotated",secret:"a".repeat(64)}).verify(issued.token,"browser",intent.action));
 const hunts=new Hunts({store:{transact:()=>{throw new Error("storage reached");}}});
 await assert.rejects(hunts.control({confirmed:{confirmation:verifiedControl(authority)}}),/Verified browser/);
 assert.throws(()=>verifiedControl({...authority}),/Verified browser/);
});
test("control guards reject observed fractional deadline bug and old structural authority",()=>{
 const codec=readFileSync("src/controls/codec.ts","utf8"),hunt=readFileSync("src/hunt/index.ts","utf8");
 checkBrowserControls(codec,hunt);
 assert.throws(()=>checkBrowserControls(codec.replace("Math.floor(databaseTime)","databaseTime"),hunt),/Round database/);
 assert.throws(()=>checkBrowserControls(codec.replace("if (!valid.has(value))", "if (false)"),hunt),/runtime authority/);
 assert.throws(()=>checkBrowserControls(codec,hunt.replace("verifiedControl(confirmed)","confirmed.confirmation")),/runtime authority/);
 assert.throws(()=>checkBrowserControls(codec,hunt.replace("await tx.databaseTime()","Date.now()")),/database time/);
 assert.throws(()=>checkBrowserControls(codec.replace("nonce(token:string)","unsafe() { return Reflect.construct(Authority, []); } nonce(token:string)"),hunt),/constructs authority/);
 assert.throws(()=>checkHuntAuthority('export type Person = {kind:"person";account:string;incarnation:string};'),/structural Person/);
 assert.throws(()=>checkControlImports("src/mcp/authenticated.ts",'import {ControlCodec} from "../controls/codec.js";'),/cannot import codec/);
 assert.throws(()=>checkControlImports("src/mcp/authenticated.ts",'import type {ControlCodec} from "../controls/codec.js";'),/cannot import codec/);
 assert.throws(()=>checkControlImports("src/mcp/authenticated.ts",'import("../controls/codec.js");'),/cannot import codec/);
 assert.throws(()=>checkPublicAuthority('export { ControlCodec } from "./controls/codec.js";'),/public barrel/);
});

test("browser controls keep one runnable verification route",()=>{
 const skill=readFileSync(".agents/skills/verify-scoat/SKILL.md","utf8"),index=readFileSync(".agents/skills/verify-scoat/features/README.md","utf8"),runner=readFileSync("scripts/verify.mjs","utf8");
 checkControlVerification(skill,index,runner);
 for(const [a,b,c] of [[skill.replace("P07 browser-authorized Stop and Skip","P07 pending"),index,runner],[skill.replace("features/controls.md","features/pending.md"),index,runner],[skill,index.replace("[browser controls](controls.md)",""),runner],[skill,index,runner.replace('import("./verify-controls.mjs")','import("./pending.mjs")')]])assert.throws(()=>checkControlVerification(a,b,c),/Route browser controls/);
});
