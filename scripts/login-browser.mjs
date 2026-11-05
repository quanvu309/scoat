import assert from "node:assert/strict";
import {createHash,randomBytes} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createServer} from "node:https";
import path from "node:path";
import {chromium} from "playwright";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {authFixture} from "./auth-fixture.mjs";
export async function loginBrowser(databaseUrl, evidence) {
 await mkdir(evidence,{recursive:true});
 let callbackServer,callback;
 const f=await authFixture(databaseUrl,{beforeStart:async({root,config})=>{
  callbackServer=createServer({key:await readFile(root+"/key.pem"),cert:await readFile(root+"/cert.pem")},(req,res)=>{callback="https://localhost:"+callbackServer.address().port+req.url;res.end("OAuth callback captured");});
  await new Promise(resolve=>callbackServer.listen(0,"127.0.0.1",resolve));
  config.clients[0].redirect_uris=["https://localhost:"+callbackServer.address().port+"/cb"];
  await writeFile(root+"/auth.json",JSON.stringify(config));
 }}), browser=await chromium.launch();
 let client;
 try {
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}}),page=await context.newPage();
  async function capture(name) {
   for (const viewport of [{name:"desktop",width:1440,height:900},{name:"phone",width:390,height:844}]) {
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    const button=page.locator('form[action="/login/send"] button, form[action="/login/complete"] button').filter({visible:true}).first();
    const bounds=await button.boundingBox();
    assert.ok(bounds && bounds.y>=0 && bounds.y+bounds.height<=viewport.height,"login submit fits "+viewport.name);
    await page.screenshot({path:path.join(evidence,name+"-"+viewport.name+".png"),fullPage:true});
   }
   await page.setViewportSize({width:1440,height:900});
  }
  await page.goto(f.issuer+"/login");
  await capture("login-entry");
  await page.screenshot({path:path.join(evidence,"a2-1-email.png"),fullPage:true});
  await page.getByLabel("Email",{exact:true}).fill(f.addressFor());
  const sent=page.waitForResponse(response=>response.url()===f.issuer+"/login/send"&&response.request().method()==="POST");
  await page.getByRole("button",{name:"Send code",exact:true}).click();
  assert.equal((await sent).status(),200);
  await page.getByLabel("Code",{exact:true}).waitFor();
  await capture("login-code");
  await page.screenshot({path:path.join(evidence,"a2-2-code.png"),fullPage:true});
  await page.getByLabel("Code",{exact:true}).fill(f.mail.at(-1).text.match(/[0-9]{6}/)[0]);
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.getByRole("button",{name:"Create account",exact:true}).waitFor();
  await page.screenshot({path:path.join(evidence,"a2-3-enroll.png"),fullPage:true});
  await page.getByRole("button",{name:"Create account",exact:true}).click();
  await page.getByText("You are signed in",{exact:true}).waitFor();
  await page.screenshot({path:path.join(evidence,"a2-4-session.png"),fullPage:true});
  assert((await context.cookies()).some(cookie=>cookie.name==="__Host-scoat-session"&&cookie.secure&&cookie.httpOnly));
  const count=f.mail.length,verifier=randomBytes(32).toString("base64url"),state=randomBytes(32).toString("hex"),redirect=f.config.clients[0].redirect_uris[0];
  await page.goto(f.issuer+"/auth?"+new URLSearchParams({client_id:"host-one",redirect_uri:redirect,response_type:"code",scope:"openid offline_access scoat:read scoat:write",resource:f.issuer+"/mcp",state,code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256"}));
  await page.getByRole("button",{name:"Allow",exact:true}).waitFor();
  assert.equal(await page.locator('form[action="/login/send"]').count(),0);
  assert.equal(f.mail.length,count);
  await page.screenshot({path:path.join(evidence,"a2-5-consent-without-code.png"),fullPage:true});
  await page.getByRole("button",{name:"Allow",exact:true}).click();
  try { await page.getByText("OAuth callback captured").waitFor({timeout:10000}); }
  catch(error) { await page.screenshot({path:path.join(evidence,"a2-failed-callback.png"),fullPage:true}); throw new Error("Native callback failed at "+page.url().split("?")[0]+": "+(await page.locator("body").innerText()).slice(0,300),{cause:error}); }
  const params=new URL(callback).searchParams;assert.equal(params.get("state"),state);
  const response=await fetch(f.issuer+"/token",{method:"POST",body:new URLSearchParams({client_id:"host-one",grant_type:"authorization_code",code:params.get("code"),code_verifier:verifier,redirect_uri:redirect,resource:f.issuer+"/mcp"})});
  const tokens=await response.json();assert.equal(response.status,200,JSON.stringify(tokens));assert.equal(typeof tokens.refresh_token,"string");
  client=new Client({name:"scoat-email-login-proof",version:"1"});
  await client.connect(new StreamableHTTPClientTransport(new URL(f.issuer+"/mcp"),{requestInit:{headers:{authorization:"Bearer "+tokens.access_token}}}));
  const result=await client.callTool({name:"scoat_hunt",arguments:{op:"list"}});assert.equal(result.structuredContent.ok,true);
  await page.goto(f.issuer+"/account/erase");
  assert.equal(await page.locator('form[action="/login/send"]').count(),1);assert.equal(f.mail.length,count);
  await page.screenshot({path:path.join(evidence,"a2-6-erase-fresh-code.png"),fullPage:true});
  await f.nativeLogin(page);
  await page.getByRole("button",{name:"Erase this account",exact:true}).waitFor();
  await page.locator("code").evaluate(element=>element.textContent="[masked status secret]");
  await page.screenshot({path:path.join(evidence,"a2-7-erase-confirmation.png"),fullPage:true});
  return {standalone:true,explicitEnrollment:true,sessionReusedWithoutMail:true,consent:true,pkceExchange:true,refreshToken:true,authenticatedSdkTool:true,eraseRequiresFreshCode:true,chromium:browser.version(),screenshots:evidence};
 } finally {await client?.close();await browser.close();await new Promise(resolve=>callbackServer.close(resolve));await f.close();}
}
