import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { authFixture } from "./auth-fixture.mjs";

export async function confirm(f, url, action, decision, submit=true) {
 let response;
 for (let n=0;n<20;n++) {
  response = await f.browser(url);
  if (response.status===200) break;
  assert.ok([302,303].includes(response.status),await response.text());
  url = new URL(response.headers.get("location"),url).href;
 }
 assert.equal(response.status,200);
 const html = await response.text();
 const confirmation = html.match(/name="confirmation" value="([^"]+)"/)?.[1];
 assert.ok(confirmation,html);
 const body = new URLSearchParams({confirmation,decision});
 if (!submit) return {confirmation,html,body,url:f.issuer+action,cookie:response.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ")};
 const result = await f.browser(f.issuer+action,{method:"POST",headers:{origin:f.issuer,"content-type":"application/x-www-form-urlencoded"},body});
 return { result, confirmation, html, body };
}
export async function memoryLanes(databaseUrl) {
 const f = await authFixture(databaseUrl);
 const transcript = [];
 try {
  const one = await f.login();
  const principal = await f.authenticate(one.token);
  const scope = [principal.agent.account,principal.agent.incarnation];
  const memory = async (request, token=one.token) => {
   const result = await f.tool(token,"scoat_memory",request);
   assert.ok(!result.isError,JSON.stringify(result));
   return result.structuredContent;
  };
  const command = { op:"profile",requestKey:randomUUID(),profile:{student:"yes",cards:["SYNTHETIC"],memberships:[]} };
  const proposal = await memory(command);
  assert.equal(proposal.kind,"confirmation-required");
  transcript.push({step:"propose-profile",kind:proposal.kind,command:proposal.command});
  assert.equal((await memory({op:"read"})).profile,null);
  const consent = await confirm(f,proposal.url,"/account/memory","allow");
  assert.equal(consent.result.status,200,await consent.result.text());
  const applied = await memory(command);
  assert.equal(applied.kind,"profile");
  transcript.push({step:"apply-profile",outcome:applied,overview:await memory({op:"read"})});
  assert.deepEqual(await memory(command),applied);
  const replay = await f.browser(f.issuer+"/account/memory",{method:"POST",headers:{origin:f.issuer,"content-type":"application/x-www-form-urlencoded"},body:consent.body});
  assert.equal(replay.status,400);
  const changed = await f.tool(one.token,"scoat_memory",{...command,profile:{...command.profile,student:"no"}});
  assert.ok(changed.isError);
  const two = await f.login("host-two");
  assert.deepEqual((await memory({op:"read"},two.token)).profile.value,command.profile);
  assert.ok((await f.tool(two.token,"scoat_memory",command)).isError);
  const start = await f.tool(one.token,"scoat_hunt",{op:"start",requestKey:randomUUID(),profile:null,intent:{product:{kind:"description",text:"SYNTHETIC memory fixture"},variant:null,shop:null,budget:null}});
  assert.ok(start.structuredContent.ok,JSON.stringify(start));
  let view = start.structuredContent.value.view;
  const original = await f.store.pool.query("SELECT data->'profile' AS profile FROM durable_hunts WHERE account=$1 AND incarnation=$2 AND id=$3",[...scope,view.hunt]);
  assert.deepEqual(original.rows[0].profile,command.profile);
  const provenance = (await f.store.pool.query("SELECT data->'profileProvenance' AS value FROM durable_hunts WHERE account=$1 AND incarnation=$2 AND id=$3",[...scope,view.hunt])).rows[0].value;
  assert.deepEqual(provenance,{kind:"declared",revision:applied.revision});
  const edit = {...command,requestKey:randomUUID(),profile:{student:"no",cards:[],memberships:[]}};
  const editProposal = await memory(edit);
  const editConsent = await confirm(f,editProposal.url,"/account/memory","allow");
  assert.equal(editConsent.result.status,200);
  await memory(edit);
  assert.deepEqual((await f.store.pool.query("SELECT data->'profile' AS profile FROM durable_hunts WHERE account=$1 AND incarnation=$2 AND id=$3",[...scope,view.hunt])).rows[0].profile,command.profile);
  const unfinished = {op:"save",requestKey:randomUUID(),hunt:view.hunt};
  const unfinishedProposal = await memory(unfinished);
  assert.equal((await confirm(f,unfinishedProposal.url,"/account/memory","allow")).result.status,200);
  assert.equal((await memory(unfinished)).kind,"unfinished");
  assert.equal((await memory({op:"read",collection:"saved"})).items.length,0);
  for (const row of view.rows) for (const slot of row.slots) {
   const current = view.rows.find(value=>value.row.id===row.row.id);
   const record = await f.tool(one.token,"scoat_hunt",{op:"record",requestKey:randomUUID(),hunt:view.hunt,row:row.row.id,slot:slot.slot,expected:current.revision,outcome:{kind:"gap",reason:"SYNTHETIC unavailable"}});
   assert.ok(record.structuredContent.ok,JSON.stringify(record)); view=record.structuredContent.value.view;
  }
  const finished = await f.tool(one.token,"scoat_hunt",{op:"finish",requestKey:randomUUID(),hunt:view.hunt,selection:null});
  assert.ok(finished.structuredContent.ok,JSON.stringify(finished));
  const save = {...unfinished,requestKey:randomUUID()};
  const saveProposal = await memory(save);
  assert.equal((await confirm(f,saveProposal.url,"/account/memory","allow")).result.status,200);
  const saved = await memory(save);
  assert.equal(saved.kind,"saved");
  const frozen = await memory({op:"item",item:saved.item});
  const sameHunt={...save,requestKey:randomUUID()};
  const sameHuntProposal=await memory(sameHunt);
  assert.equal((await confirm(f,sameHuntProposal.url,"/account/memory","allow")).result.status,200);
  assert.deepEqual(await memory(sameHunt),saved);
  assert.equal((await memory({op:"read",collection:"saved"})).items.length,1);
  const secondStart=await f.tool(one.token,"scoat_hunt",{op:"start",requestKey:randomUUID(),profile:null,intent:{product:{kind:"description",text:"SYNTHETIC recent second"},variant:null,shop:null,budget:null}});
  assert.ok(secondStart.structuredContent.ok);
  const recent=await memory({op:"read",collection:"recent",limit:1});
  assert.equal(recent.items.length,1); assert.ok(recent.next);
  const recentNext=await memory({op:"read",collection:"recent",limit:1,after:recent.next});
  assert.equal(recentNext.items.length,1); assert.equal(recentNext.next,null);
  assert.notEqual(recent.items[0].id,recentNext.items[0].id);
  assert.ok(recent.items[0].started_at>=recentNext.items[0].started_at);

  const {Knowledge} = await import("../dist/knowledge/index.js");
  const knowledge = new Knowledge(f.knowledgeDirectory);
  const oldRelease = await knowledge.read({release:"latest"});
  const newerRelease = {...oldRelease,id:"p06-newer-release",publishedAt:new Date(Date.parse(oldRelease.publishedAt)+1000).toISOString()};
  await knowledge.publish(newerRelease,newerRelease.publishedAt);
  assert.equal((await knowledge.read({release:"latest"})).id,newerRelease.id);
  assert.deepEqual(await memory({op:"item",item:saved.item}),frozen);
  await f.restart();
  assert.deepEqual(await memory({op:"item",item:saved.item},two.token),frozen);
  assert.deepEqual(await memory(save),saved);
  const foreign = await f.login("host-one","foreign-memory-subject");
  assert.equal((await memory({op:"read"},foreign.token)).profile,null);
  assert.deepEqual((await memory({op:"read"},foreign.token)).counts,{saved:0,hunts:0});
  assert.equal((await memory({op:"read",collection:"recent"},foreign.token)).items.length,0);
  assert.ok((await f.tool(foreign.token,"scoat_memory",{op:"item",item:saved.item})).isError);
  transcript.push({profiles:true,receipts:true,sessionIsolation:true,snapshotIsolation:true,unfinishedRefusal:true,savedRestart:true,releaseFreeze:true,profileProvenance:true,foreignAccountIsolation:true});
  return {transcript,projection:frozen,savedReceipt:saved,ordinaryLog:f.logPath,postgres:"real local PostgreSQL",https:"real local issuer and upstream fixture"};
 } finally { await f.close(); }
}
