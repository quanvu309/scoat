import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { authFixture } from "./auth-fixture.mjs";
import { confirm } from "./memory-lanes.mjs";
import { ControlCodec } from "../dist/controls/codec.js";
import { Hunts } from "../dist/hunt/index.js";
import { fixture, gate } from "./durable-fixture.mjs";
export async function controlLanes(databaseUrl) {
 const f=await authFixture(databaseUrl);
 const lanes=[];
 let browser;
 try {
  const one=await f.login();
  const principal=await f.authenticate(one.token);
  const scope=[principal.agent.account,principal.agent.incarnation];
  const start=async()=>{
   const result=await f.tool(one.token,"scoat_hunt",{op:"start",requestKey:randomUUID(),profile:null,intent:{product:{kind:"description",text:"SYNTHETIC controls"},variant:null,shop:null,budget:null}});
   assert.ok(result.structuredContent.ok,JSON.stringify(result));
   return result.structuredContent;
  };
  const read=async hunt=>(await f.tool(one.token,"scoat_hunt",{op:"read",hunt})).structuredContent.value.view;
  const pending=async url=>{
   const result=await confirm(f,url,"/account/control","",false);
   const get=name=>result.html.match(new RegExp('name="'+name+'" value="([^"]+)"'))?.[1].replaceAll("&quot;",'"').replaceAll("&amp;","&");
   result.body=new URLSearchParams({confirmation:get("confirmation"),csrf:get("csrf"),action:get("action")});
   return result;
  };
  const post=(body,headers={})=>f.browser(f.issuer+"/account/control",{method:"POST",headers:{origin:f.issuer,"content-type":"application/x-www-form-urlencoded",...headers},body});
  const created=await start(), hunt=created.value.view.hunt;
  const hub=await pending(created.controls.hub);assert.equal((hub.html.match(/<form /g)??[]).length,created.value.view.rows.length+1);
  const approval=await pending(created.controls.stop);
  assert.equal((await read(hunt)).stopRequested,false);
  assert.equal((await f.store.pool.query("SELECT count(*) AS n FROM hunt_receipts WHERE account=$1 AND incarnation=$2 AND key LIKE 'person:%'",scope)).rows[0].n,"0");
  lanes.push("fresh login and GET never mutate");
  assert.equal((await post(approval.body,{origin:"https://foreign.invalid"})).status,403);
  assert.equal((await fetch(f.issuer+"/account/control",{method:"POST",headers:{origin:f.issuer,"content-type":"application/x-www-form-urlencoded"},body:approval.body})).status,400);
  for(const [field,value] of [["csrf","x".repeat(43)],["action",JSON.stringify({kind:"skip",row:created.value.view.rows[0].row.id})],["confirmation",approval.body.get("confirmation")+"x"]]) {
   const body=new URLSearchParams(approval.body);body.set(field,value); assert.equal((await post(body)).status,400);
  }
  assert.equal((await fetch(f.issuer+"/account/control",{method:"POST",headers:{origin:f.issuer,"content-type":"application/x-www-form-urlencoded",cookie:approval.cookie.replace(/=.*/,"=wrong")},body:approval.body})).status,400);
  const duplicate=new URLSearchParams(approval.body);duplicate.append("csrf",approval.body.get("csrf"));assert.equal((await post(duplicate)).status,400);
  assert.equal((await post(new URLSearchParams({padding:"x".repeat(9000)}))).status,400);
  lanes.push("wrong Origin cookie nonce action signature duplicate and oversized form refused");
  const results=await Promise.all([post(approval.body),post(approval.body)]);
  const compact=await results[0].json();
  assert.equal(results[0].status,200);assert.deepEqual(await results[1].json(),compact);
  assert.equal(compact.value.status,"applied");assert.equal("view" in compact.value,false);
  assert.deepEqual(await (await post(approval.body)).json(),compact);
  assert.equal((await f.store.pool.query("SELECT count(*) AS n FROM hunt_receipts WHERE account=$1 AND incarnation=$2 AND key=$3",[...scope,"person:"+approval.body.get("csrf")])).rows[0].n,"1");
  const stopped=(await f.store.pool.query("SELECT data->>'stopRequestedAt' AS stamp FROM durable_hunts WHERE account=$1 AND incarnation=$2 AND id=$3",[...scope,hunt])).rows[0].stamp;
  const again=await pending(created.controls.stop);
  assert.equal((await (await post(again.body)).json()).value.status,"unchanged");
  assert.equal((await f.store.pool.query("SELECT data->>'stopRequestedAt' AS stamp FROM durable_hunts WHERE account=$1 AND incarnation=$2 AND id=$3",[...scope,hunt])).rows[0].stamp,stopped);
  lanes.push("concurrent POST saved compact replay and independent repeat Stop");
  const frozen=await start();
  for(const link of frozen.controls.skip) {
   const consent=await pending(link.url);assert.equal((await post(consent.body)).status,200);
  }
  const finished=await f.tool(one.token,"scoat_hunt",{op:"finish",requestKey:randomUUID(),hunt:frozen.value.view.hunt,selection:null});
  assert(finished.structuredContent.ok);
  const finalBefore=finished.structuredContent.value.view;
  const finalConsent=await pending(frozen.controls.stop);
  assert.equal((await (await post(finalConsent.body)).json()).value.status,"finished");
  assert.deepEqual(await read(frozen.value.view.hunt),finalBefore);
  lanes.push("finished snapshot remains byte-equivalent after a newly confirmed control");
  const second=await start(), row=second.value.view.rows[0];
  const skip=await pending(second.controls.skip[0].url);
  const lost=await post(skip.body); await lost.body.cancel();
  assert.equal((await (await post(skip.body)).json()).value.status,"applied");
  const skipAgain=await pending(second.controls.skip[0].url);
  assert.equal((await (await post(skipAgain.body)).json()).value.status,"unchanged");
  assert.equal((await read(second.value.view.hunt)).rows[0].revision,row.revision+1);
  const late=await f.tool(one.token,"scoat_hunt",{op:"record",requestKey:randomUUID(),hunt:second.value.view.hunt,row:row.row.id,slot:row.slots[0].slot,expected:row.revision,outcome:{kind:"gap",reason:"late"}});
  assert.equal(late.structuredContent.error.code,"conflict");
  lanes.push("dropped response recovery repeat Skip and late record refusal");
  f.setIdentity("upstream-subject-B");
  let url=created.controls.stop,response;
  for(let n=0;n<20;n++){response=await f.browser(url);if(![302,303].includes(response.status))break;url=new URL(response.headers.get("location"),url).href;}
  assert.equal(response.status,400);
  f.setIdentity("upstream-subject-A");
  lanes.push("fresh foreign identity cannot obtain confirmation");
  browser=await chromium.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true});
  const page=await context.newPage();
  const native=await start();
  const get=await page.goto(native.controls.stop);
  assert.equal(get.status(),200);assert.equal((await get.allHeaders())["referrer-policy"],"same-origin");
  const cookies=await context.cookies();
  assert(cookies.some(cookie=>cookie.name.startsWith("__Host-scoat-control-") && cookie.secure && cookie.httpOnly && cookie.sameSite==="Strict"));
  const [posted]=await Promise.all([page.waitForResponse(response=>response.request().method()==="POST" && response.url()===f.issuer+"/account/control"),page.getByRole("button",{name:"Stop accepting new discoveries"}).click()]);
  assert.equal(posted.status(),200);assert.equal((await posted.request().allHeaders()).origin,f.issuer);
  lanes.push("native Chromium form sends exact Origin without injection");
  const dbTime=Number((await f.store.pool.query("SELECT extract(epoch FROM clock_timestamp())*1000 AS ms")).rows[0].ms);
  const codec=new ControlCodec(f.controlConfig);
  const intent={...principal.agent,hunt:second.value.view.hunt,action:{kind:"stop"}};
  delete intent.kind;delete intent.client;
  const expired=codec.issue(intent,"secret",dbTime-120001);
  const hunts=new Hunts({store:f.store});
  const originalNow=Date.now;Date.now=()=>originalNow()-3600000;
  try {const result=await hunts.control({confirmed:codec.verify(expired.token,"secret",intent.action)});assert.equal(result.error.code,"forbidden");} finally {Date.now=originalNow;}
  const expiredBody=new URLSearchParams({confirmation:expired.token,csrf:expired.nonce,action:JSON.stringify(intent.action)});
  const expiredPost=await fetch(f.issuer+"/account/control",{method:"POST",headers:{origin:f.issuer,"content-type":"application/x-www-form-urlencoded",cookie:`__Host-scoat-control-${expired.nonce}=secret`},body:expiredBody});
  assert.equal(expiredPost.status,403);
  lanes.push("HTTPS expired confirmation refused; database expiry survives one-hour application clock skew");
  const waiting=await pending(second.controls.stop);
  const flow=await f.browser(second.controls.stop);assert.equal(flow.status,303);
  assert((await f.store.pool.query("SELECT 1 FROM oauth_browser_flow_owners WHERE account=$1",[scope[0]])).rowCount);
  const linked=await f.link("upstream-subject-B","upstream-subject-A");
  assert.equal(linked.status,400);
  assert.equal((await f.authenticate(one.token)).agent.account,scope[0]);
  lanes.push("pending confirmation owner cannot move to another account with hunts");
  f.setIdentity("upstream-subject-A");
  const erased=await confirm(f,f.issuer+"/account/erase","/account/erase","erase");assert.equal(erased.result.status,200);
  assert.equal((await post(waiting.body)).status,403);
  for(const table of ["hunt_receipts","oauth_browser_flow_owners"])assert.equal((await f.store.pool.query(`SELECT count(*) AS n FROM ${table} WHERE account=$1`,[scope[0]])).rows[0].n,"0");
  await f.login();assert.equal((await fetch(f.issuer+"/account/control",{method:"POST",headers:{origin:f.issuer,"content-type":"application/x-www-form-urlencoded",cookie:waiting.cookie},body:waiting.body})).status,403);
  lanes.push("control before erasure removed; erasure before control refused; stale confirmation after re-enrollment refused");
  return {lanes:lanes.map(name=>({name,status:"PASS"})),browser:browser.version(),card:"SEPARATE: npm run verify -- p07-card",externalHosts:"UNTESTED"};
 } finally {await browser?.close();await f.close();}
}

export async function controlRaceLanes(databaseUrl) {
 const proofs=[];
 for(const order of ["replay","control-before-erase","erase-before-control"]) {
  const f=await fixture(databaseUrl);
  const held=gate(),release=gate(),entered=gate();
  try {
   const view=await f.start(),key=randomUUID();
   const probe=async(client,lock)=>{
    await client.query("SAVEPOINT control_contention");
    let code;
    try {
     await client.query(lock==="account" ? "SELECT account FROM hunt_accounts WHERE account=$1 AND incarnation=$2 FOR UPDATE NOWAIT" : "SELECT id FROM durable_hunts WHERE account=$1 AND incarnation=$2 AND id=$3 FOR UPDATE NOWAIT",lock==="account" ? [f.scope.account,f.scope.incarnation] : [f.scope.account,f.scope.incarnation,view.hunt]);
    } catch(error) {if(error.code!=="55P03")throw error;code=error.code;}
    finally {await client.query("ROLLBACK TO SAVEPOINT control_contention");await client.query("RELEASE SAVEPOINT control_contention");}
    assert.equal(code,"55P03");proofs.push({order,lock,code});entered.resolve();
   };
   if(order==="erase-before-control") {
    f.hooks.afterAccountFence=async scope=>{if(scope.accountFence==="exclusive"){held.resolve();await release.promise;}};
    f.hooks.beforeAccountFence=async(scope,client)=>{if(scope.accountFence==="shared")await probe(client,"account");};
   } else {
    f.hooks.beforeCommit=async scope=>{if(scope.request?.key===f.controlKey(key)){held.resolve();await release.promise;}};
    if(order==="replay") {
     let entries=0;
     f.hooks.afterAccountFence=async(scope,client)=>{if(++entries===2)await probe(client,"hunt");};
    } else f.hooks.beforeAccountFence=async(scope,client)=>{if(scope.accountFence==="exclusive")await probe(client,"account");};
   }
   const control=()=>f.control(view,{kind:"stop"},key);
   const erase=()=>f.erase({account:f.scope});
   const first=order==="erase-before-control" ? erase() : control();
   await held.promise;
   const second=order==="control-before-erase" ? erase() : control();
   await entered.promise;release.resolve();
   const [a,b]=await Promise.all([first,second]);
   for(const hook of Object.keys(f.hooks))delete f.hooks[hook];
   if(order==="replay") {
    assert.deepEqual(a,b);assert.equal(a.value.status,"applied");
    assert.equal((await f.store.pool.query("SELECT count(*) AS n FROM hunt_receipts WHERE account=$1 AND incarnation=$2 AND key LIKE 'person:%'",[f.scope.account,f.scope.incarnation])).rows[0].n,"1");
   } else {
    if(order==="control-before-erase")assert.equal(a.value.status,"applied");
    else assert.equal(b.error.code,"forbidden");
    assert.equal((await control()).error.code,"forbidden");
    assert.equal((await f.store.pool.query("SELECT count(*) AS n FROM hunt_receipts WHERE account=$1 AND incarnation=$2",[f.scope.account,f.scope.incarnation])).rows[0].n,"0");
   }
  } finally {release.resolve();await f.store.close();}
 }
 return proofs;
}
