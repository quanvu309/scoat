import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { withDatabase } from "../scripts/durable-database.mjs";
import { authFixture } from "../scripts/auth-fixture.mjs";
import { Login, LoginRefused } from "../dist/auth/login.js";
import { Delivery } from "../dist/delivery/index.js";
import type { MailMessage, Submission } from "../src/delivery/index.js";

class Capture extends Delivery {
 code = "";
 result: Submission = {kind:"accepted",id:"fixture"};
 constructor() { super({resolve:async()=>[],mail:{origin:"https://example.invalid",apiKey:"fixture"}}); }
 override async submit(message: MailMessage): Promise<Submission> { this.code = message.text.match(/[0-9]{6}/)?.[0] ?? ""; return this.result; }
}
test("email codes bind flow and purpose, expire, cap attempts, serialize consumption and enforce separate mail budgets", async () => {
 await withDatabase(async (url: string) => {
  const f = await authFixture(url);
  try {
   const mail = new Capture(), login = new Login(f.store.pool,f.config.lifecycleKey,f.config.loginMailFrom,mail);
   assert.throws(()=>new Login(f.store.pool,f.config.lifecycleKey,f.config.loginMailFrom,Delivery.production(null)),LoginRefused);
   const flow = async () => {
    const response = await f.browser(f.issuer+"/login");
    assert.match(response.headers.get("cache-control") ?? "",/no-store/);
    const html = await response.text(), state = html.match(/name="state" value="([^"]+)"/)?.[1];
    assert.ok(state); assert.match(html,/inputmode="numeric"/); assert.match(html,/autocomplete="one-time-code"/);
    const digest = createHash("sha256").update(state).digest("hex");
    const row = (await f.store.pool.query("SELECT data FROM oauth_browser_flows WHERE state=$1",[digest])).rows[0];
    return {raw:state,state:digest,browser:row.data.browser,start:row.data.initiatedAt};
   };
   const clear = () => f.store.pool.query("DELETE FROM login_mail_budget");
   const send = async (address="person@example.invalid") => {
    await clear(); const value=await flow(); assert.equal(await login.send(value.state,value.browser,"login",address),true); return {...value,code:mail.code};
   };
   let value=await send();
   const stored=(await f.store.pool.query("SELECT code_digest FROM login_challenges WHERE state=$1",[value.state])).rows[0];
   assert.notEqual(stored.code_digest,value.code); assert.equal(stored.code_digest.length,64);
   assert.equal(await login.consume(value.state,"other","login",value.code),null);
   assert.equal(await login.consume(value.state,value.browser,"erase",value.code),null);
   assert.equal(await login.consume(value.state,value.browser,"login","wrong"),null);
   assert.ok(await login.consume(value.state,value.browser,"login",value.code));
   assert.equal(await login.consume(value.state,value.browser,"login",value.code),null);
   value=await send();
   for(let attempt=0;attempt<5;attempt++) assert.equal(await login.consume(value.state,value.browser,"login","wrong"),null);
   assert.equal(await login.consume(value.state,value.browser,"login",value.code),null);
   value=await send();
   await f.store.pool.query("UPDATE login_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE state=$1",[value.state]);
   assert.equal(await login.consume(value.state,value.browser,"login",value.code),null);
   value=await send();
   assert.equal(await login.send(value.state,value.browser,"login","person@example.invalid"),true);
   assert.equal((await f.store.pool.query("SELECT data->>'initiatedAt' AS start FROM oauth_browser_flows WHERE state=$1",[value.state])).rows[0].start,String(value.start));
   if (value.code !== mail.code) assert.equal(await login.consume(value.state,value.browser,"login",value.code),null);
   const results=await Promise.all([login.consume(value.state,value.browser,"login",mail.code),login.consume(value.state,value.browser,"login",mail.code)]);
   assert.equal(results.filter(Boolean).length,1);
   value=await send(); mail.result={kind:"ambiguous",reason:"deadline"};
   assert.equal(await login.send(value.state,value.browser,"login","person@example.invalid"),false);
   assert.equal(await login.consume(value.state,value.browser,"login",mail.code),null);
   mail.result={kind:"rejected",status:429}; assert.equal(await login.send(value.state,value.browser,"login","person@example.invalid"),false);
   assert.equal(await login.consume(value.state,value.browser,"login",mail.code),null);
   mail.result={kind:"accepted",id:"fixture"}; await clear();
   for(let attempt=0;attempt<3;attempt++) assert.equal(await login.send(value.state,value.browser,"login","person@example.invalid"),true);
   assert.equal(await login.send(value.state,value.browser,"login","person@example.invalid"),false);
   await clear();
   for(let attempt=0;attempt<11;attempt++) assert.equal(await login.send(value.state,value.browser,"login",`person${attempt}@example.invalid`),true);
   assert.equal(await login.send(value.state,value.browser,"login","tail@example.invalid"),true);
   await clear();
   await f.store.pool.query("INSERT INTO login_mail_budget(bucket,window_start,used) VALUES('daily',date_trunc('day',clock_timestamp()),80)");
   assert.equal(await login.send(value.state,value.browser,"login","new@example.invalid"),false);
   await clear();
   const enumeration=await flow();
   const sendHttp=(email:string)=>f.browser(f.issuer+"/login/send",{method:"POST",headers:{origin:f.issuer},body:new URLSearchParams({state:enumeration.raw,email})});
   const known=await sendHttp("person@example.invalid"),unknown=await sendHttp("fresh@example.invalid");
   assert.equal(known.status,unknown.status);assert.equal(await known.text(),await unknown.text());
   const missing = await f.browser(f.issuer+"/login/send",{method:"POST",headers:{origin:"https://foreign.invalid"},body:new URLSearchParams({state:"forged",email:"person@example.invalid"})});
   assert.equal(missing.status,403);
  } finally { await f.close(); }
 });
});
