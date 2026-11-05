import assert from "node:assert/strict";
import { chromium } from "playwright";
import { authFixture } from "./auth-fixture.mjs";
import { confirm } from "./memory-lanes.mjs";

export async function recoveryBrowserLane(databaseUrl) {
 const f = await authFixture(databaseUrl);
 let browser;
 try {
  await f.login();
  const erased = await confirm(f,f.issuer+"/account/erase","/account/erase","erase");
  assert.equal(erased.result.status,200);
  const secret = erased.html.match(/<code>([^<]+)<\/code>/)?.[1];
  assert.ok(secret);
  assert.match(erased.html,/href="\/account\/erase-status"/);
  browser = await chromium.launch();
  const context = await browser.newContext({ignoreHTTPSErrors:true});
  const page = await context.newPage();
  const recovery = new URL("/account/erase-status",f.issuer).href;
  const get = await page.goto(recovery);
  assert.ok(get);
  assert.equal(get.status(),200);
  const headers = await get.allHeaders();
  await page.getByLabel("Status secret").fill(secret);
  const [post] = await Promise.all([
   page.waitForResponse(response => response.url() === recovery && response.request().method() === "POST"),
   page.getByRole("button",{name:"Check erasure result"}).click()
  ]);
  const requestHeaders = await post.request().allHeaders();
  assert.equal(post.status(),200,JSON.stringify({origin:requestHeaders.origin,status:post.status(),referrerPolicy:headers["referrer-policy"]}));
  assert.equal(requestHeaders.origin,f.issuer);
  assert.equal(headers["cache-control"],"no-store");
  assert.equal(headers["referrer-policy"],"same-origin");
  const status = await post.json();
  assert.deepEqual(Object.keys(status).sort(),["completed_at","operation","policy"]);
  assert.ok(status.completed_at);
  assert.equal(status.policy,"p06-v1");
  assert.equal(new URL(post.url()).search,"");
  assert.ok(!post.url().includes(secret));
  assert.equal((await context.cookies()).length,0);
  return {engine:"Chromium",version:browser.version(),credentialFreeNativeForm:true,originPreserved:true,status:post.status(),minimalStatusKeys:Object.keys(status).sort(),secretInUrl:false,localSelfSignedHttps:true,externalAcceptance:"UNTESTED"};
 } finally {
  try { await browser?.close(); } finally { await f.close(); }
 }
}
