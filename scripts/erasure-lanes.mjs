import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { authFixture } from "./auth-fixture.mjs";
import { confirm } from "./memory-lanes.mjs";
import { postgresAdapter } from "../dist/auth/adapter.js";
import { resolveIdentity } from "../dist/auth/identity.js";
import { eraseAccount } from "../dist/accounts/erasure.js";
export async function erasureLanes(databaseUrl) {
 const f = await authFixture(databaseUrl);
 try {
  const one = await f.login();
  const principal = await f.authenticate(one.token), scope=[principal.agent.account,principal.agent.incarnation];
  const other = await f.login("host-two","other-erasure-subject");
  const otherPrincipal = await f.authenticate(other.token);
  await f.login("host-one","upstream-subject-A");
  const adapter = postgresAdapter(f.store.pool)("Interaction");
  await adapter.upsert("nested-owners",{session:{accountId:principal.agent.account},result:{login:{accountId:otherPrincipal.agent.account}}},300);
  assert.equal((await f.store.pool.query("SELECT count(*) FROM oauth_artifact_owners WHERE model='Interaction' AND id='nested-owners'")).rows[0].count,"2");
  assert.equal((await f.store.pool.query("DELETE FROM oauth_artifacts WHERE model='Interaction' AND id='nested-owners' AND payload->>'accountId'=$1",[scope[0]])).rowCount,0);
  assert.ok(await adapter.find("nested-owners"));
  const grants=postgresAdapter(f.store.pool)("Grant"), tokens=postgresAdapter(f.store.pool)("AccessToken");
  await grants.upsert("inherited-grant",{accountId:scope[0]},300);
  await tokens.upsert("inherited-token",{grantId:"inherited-grant"},300);
  assert.equal((await f.store.pool.query("SELECT account FROM oauth_artifact_owners WHERE model='AccessToken' AND id='inherited-token'")).rows[0].account,scope[0]);

  await f.store.pool.query("INSERT INTO memory_profiles VALUES($1,$2,$3,$4)",[...scope,randomUUID(),{student:"yes",cards:["SYNTHETIC private"],memberships:[]}]);
  const command={op:"profile",requestKey:randomUUID(),profile:{student:"no",cards:[],memberships:[]}};
  await f.tool(one.token,"scoat_memory",command);
  const started=await f.tool(one.token,"scoat_hunt",{op:"start",requestKey:randomUUID(),profile:null,intent:{product:{kind:"description",text:"SYNTHETIC deletion inventory"},variant:null,shop:null,budget:null}});
  assert.ok(started.structuredContent.ok); let view=started.structuredContent.value.view;
  for (const row of view.rows) for (const slot of row.slots) {
   const revision=view.rows.find(value=>value.row.id===row.row.id).revision;
   const recorded=await f.tool(one.token,"scoat_hunt",{op:"record",requestKey:randomUUID(),hunt:view.hunt,row:row.row.id,slot:slot.slot,expected:revision,outcome:{kind:"gap",reason:"SYNTHETIC erased gap"}});
   assert.ok(recorded.structuredContent.ok); view=recorded.structuredContent.value.view;
  }
  const finished=await f.tool(one.token,"scoat_hunt",{op:"finish",requestKey:randomUUID(),hunt:view.hunt,selection:null}); assert.ok(finished.structuredContent.ok);
  const save={op:"save",requestKey:randomUUID(),hunt:view.hunt};
  const proposed=await f.tool(one.token,"scoat_memory",save);
  assert.equal((await confirm(f,proposed.structuredContent.url,"/account/memory","allow")).result.status,200);
  assert.equal((await f.tool(one.token,"scoat_memory",save)).structuredContent.kind,"saved");
  const readGrant=await f.tool(one.token,"scoat_card",{op:"open",hunt:view.hunt}); assert.ok(!readGrant.isError);
  const compatibility=randomUUID();
  await f.store.pool.query("INSERT INTO hunt_offers(account,incarnation,hunt,row_id,slot,id,data) VALUES($1,$2,$3,$4,1,'erasure-offer',$5)",[...scope,view.hunt,view.rows[0].row.id,{fixture:"SYNTHETIC private offer"}]);
  await f.store.pool.query("INSERT INTO hunt_compatibility VALUES($1,$2,$3,$4,$5)",[...scope,view.hunt,compatibility,{fixture:"SYNTHETIC private compatibility"}]);
  await f.store.pool.query("INSERT INTO hunt_compatibility_members VALUES($1,$2,$3,$4,'erasure-offer')",[...scope,view.hunt,compatibility]);
  const staleLink=await f.link("other-erasure-subject","upstream-subject-A",true);
  assert.ok(staleLink.callback);
  const staleLogin=await f.login("host-one","upstream-subject-A","scoat:read scoat:write",true);
  const erased=await confirm(f,f.issuer+"/account/erase","/account/erase","erase");
  assert.equal(erased.result.status,200,await erased.result.clone().text());
  const receipt=await erased.result.json();
  assert.equal(receipt.counts.memory_profiles,1);
  for (const table of ["memory_items","memory_commands","oauth_read_grants","durable_hunts","hunt_rows","hunt_offers","hunt_compatibility","hunt_compatibility_members","hunt_receipts"]) assert.ok(receipt.counts[table]>0,table);
  assert.equal(receipt.retention.suppressionDays,31);
  assert.equal(receipt.retention.jobs,0);
  for (const table of ["memory_profiles","memory_items","memory_commands","oauth_identities","oauth_read_grants","hunt_receipts","hunt_rows","hunt_offers","hunt_compatibility","hunt_compatibility_members","durable_hunts"]) {
   assert.equal((await f.store.pool.query(`SELECT count(*) FROM ${table} WHERE account=$1 AND incarnation=$2`,scope)).rows[0].count,"0",table);
  }
  assert.equal((await f.store.pool.query("SELECT count(*) FROM oauth_artifact_owners WHERE account=$1",[scope[0]])).rows[0].count,"0");
  assert.equal(await adapter.find("nested-owners"),undefined);
  assert.equal(await tokens.find("inherited-token"),undefined);
  await assert.rejects(tokens.upsert("late-parent-token",{grantId:"inherited-grant"},300),/parent unavailable/);
  await assert.rejects(adapter.upsert("late-owned",{result:{login:{accountId:scope[0]}}},300),/Inactive OAuth owner/);
  assert.equal((await f.rpc(one.token,"tools/list")).status,401);
  assert.equal((await f.rpc(other.token,"tools/list")).status,200);
  await assert.rejects(resolveIdentity(f.store.pool,f.config.upstreamIssuer,"upstream-subject-A"),/Explicit browser enrollment/);
  const {Memory}=await import("../dist/memory/index.js");
  await assert.rejects(new Memory(f.store.pool,f.issuer,false).run({...principal.agent,session:principal.session},command),/Inactive account/);
  const status=erased.html.match(/<code>([^<]+)<\/code>/)?.[1]; assert.ok(status);
  const recoveryPath=erased.html.match(/href="([^"]+)"[^>]*>check the erasure result/)?.[1];
  assert.equal(recoveryPath,"/account/erase-status");
  const recoveryUrl=new URL(recoveryPath,f.issuer);
  const recoveryPage=await fetch(recoveryUrl);
  assert.equal(recoveryPage.status,200);
  assert.equal(recoveryPage.headers.get("cache-control"),"no-store");
  assert.equal(recoveryPage.headers.get("referrer-policy"),"same-origin");
  assert.match(recoveryPage.headers.get("content-security-policy"),/form-action 'self'/);
  const recoveryHtml=await recoveryPage.text();
  assert.match(recoveryHtml,/<input type="password" name="status"/);
  const recoveryForm=recoveryHtml.match(/<form method="(post)" action="([^"]+)"/);
  assert.ok(recoveryForm);
  assert.equal((await fetch(new URL(recoveryForm[2],recoveryUrl),{method:recoveryForm[1],headers:{origin:"https://foreign.invalid"},body:new URLSearchParams({status})})).status,403);
  const recovered=await fetch(new URL(recoveryForm[2],recoveryUrl),{method:recoveryForm[1],headers:{origin:recoveryUrl.origin},body:new URLSearchParams({status})});
  assert.equal(recovered.status,200);
  assert.equal(recovered.headers.get("cache-control"),"no-store");
  assert.ok((await recovered.json()).completed_at);
  assert.equal((await f.browser(f.issuer+"/account/erase",{method:"POST",headers:{origin:f.issuer},body:erased.body})).status,400);
  const ledger=(await f.store.pool.query("SELECT * FROM account_suppression WHERE account=$1",[scope[0]])).rows;
  assert.equal(ledger.length,1);
  assert.ok(!JSON.stringify(ledger).includes("upstream-subject-A"));
  await f.restart();
  const logs=await readFile(f.logPath,"utf8");
  for (const secret of [one.token,status,"SYNTHETIC private","upstream-subject-A"]) assert.ok(!logs.includes(secret),"Ordinary log leaked private data");
  const staleCallback=await fetch(staleLogin.callback,{redirect:"manual",headers:{cookie:staleLogin.cookie}});
  assert.equal(staleCallback.status,400);
  const staleLinkCallback=await fetch(staleLink.callback,{redirect:"manual",headers:{cookie:staleLink.cookie}});
  assert.equal(staleLinkCallback.status,400);
  assert.equal((await f.store.pool.query("SELECT count(*) FROM oauth_identities WHERE issuer=$1 AND subject=$2",[f.config.upstreamIssuer,"upstream-subject-A"])).rows[0].count,"0");
  const fresh=await f.login();
  const freshPrincipal=await f.authenticate(fresh.token);
  assert.notEqual(freshPrincipal.agent.account,scope[0]);
  const earlyTransaction=await f.store.pool.connect();
  let duringErase;
  try {
   await earlyTransaction.query("BEGIN");
   duringErase=await f.link("other-erasure-subject","upstream-subject-A",true);
   assert.ok(duringErase.callback);
   const statusDigest=createHash("sha256").update(randomUUID()).digest("hex");
   await earlyTransaction.query("INSERT INTO erase_status(digest,operation) VALUES($1,$2)",[statusDigest,randomUUID()]);
   await eraseAccount(earlyTransaction,freshPrincipal.agent,f.config.lifecycleKey,f.config.lifecycleKeyVersion,statusDigest);
   await earlyTransaction.query("COMMIT");
  } catch(error) { await earlyTransaction.query("ROLLBACK"); throw error; }
  finally { earlyTransaction.release(); }
  assert.equal((await fetch(duringErase.callback,{redirect:"manual",headers:{cookie:duringErase.cookie}})).status,400);
  assert.equal((await f.link("other-erasure-subject","upstream-subject-A")).status,200);
  assert.equal((await resolveIdentity(f.store.pool,f.config.upstreamIssuer,"upstream-subject-A")).account,otherPrincipal.agent.account);
  const confirmationCandidate=await f.login("host-one","erasure-confirm-subject");
  const confirmationPrincipal=await f.authenticate(confirmationCandidate.token);
  const acrossConfirmation=await f.link("other-erasure-subject","erasure-confirm-subject",false,async()=>{
   const client=await f.store.pool.connect();
   try {
    await client.query("BEGIN");
    const statusDigest=createHash("sha256").update(randomUUID()).digest("hex");
    await client.query("INSERT INTO erase_status(digest,operation) VALUES($1,$2)",[statusDigest,randomUUID()]);
    await eraseAccount(client,confirmationPrincipal.agent,f.config.lifecycleKey,f.config.lifecycleKeyVersion,statusDigest);
    await client.query("COMMIT");
   } catch(error) { await client.query("ROLLBACK"); throw error; }
   finally { client.release(); }
  });
  assert.equal(acrossConfirmation.status,400);
  return {transcript:[{atomicOwnerDeletion:true,nestedMultiOwners:true,lateOAuthWriteDenied:true,cachedPrincipalDenied:true,oldBearerDenied:true,statusRecovery:true,recoveryFormReachableWithoutCredentials:true,foreignRecoveryOriginDenied:true,staleVerifiedCallbackDenied:true,staleLinkCallbackDenied:true,linkConfirmationSpansErasure:true,transactionStartDoesNotWeakenSuppression:true,freshPostErasureLinkAllowed:true,explicitFreshEnrollment:true}],receipt,ordinaryLog:f.logPath,jobs:0,postgres:"real PostgreSQL",https:"real local HTTPS"};
 } finally { await f.close(); }
}
