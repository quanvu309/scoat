import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";
import { authFixture } from "./auth-fixture.mjs";
import { eraseAccount } from "../dist/accounts/erasure.js";
import { maintainAccounts } from "../dist/accounts/maintenance.js";
import { Memory } from "../dist/memory/index.js";
import { postgresAdapter } from "../dist/auth/adapter.js";
import { persistBrowserFlow } from "../dist/auth/flows.js";
export async function lifecycleLanes(databaseUrl) {
 const migration = await readFile(new URL("../db/migrations/0002_memory_lifecycle.sql",import.meta.url),"utf8");
 const {authSchema} = await import("../dist/auth/schema.js");
 const {memorySchema} = await import("../dist/memory/schema.js");
 const {lifecycleSchema} = await import("../dist/accounts/schema.js");
 assert.equal(migration,authSchema+memorySchema+lifecycleSchema);
 const pool = new pg.Pool({connectionString:databaseUrl,max:1});
 const client = await pool.connect();
 const migrationSchema = "p06_migration_"+randomUUID().replaceAll("-","");
 try {
  await client.query("CREATE SCHEMA "+migrationSchema);
  await client.query("SET search_path TO "+migrationSchema);
  await client.query(await readFile(new URL("../db/migrations/0001_hunts.sql",import.meta.url),"utf8"));
  await client.query(authSchema);
  const retiredAccount=randomUUID();
  await client.query("INSERT INTO hunt_accounts(account,incarnation,erased) VALUES($1,$2,true)",[retiredAccount,randomUUID()]);
  await client.query("INSERT INTO oauth_artifacts VALUES('Interaction','legacy',$1,now()+interval '1 hour')",[{session:{accountId:"legacy-owner"}}]);
  await assert.rejects(client.query("ALTER TABLE hunt_accounts ADD COLUMN PERFORM pg_advisory_xact_lock(80106); IF NOT EXISTS erased_at timestamptz"),{code:"42601"});
  await client.query(migration);
  assert.equal((await client.query("SELECT count(*) FROM oauth_artifacts")).rows[0].count,"0");
  assert.equal((await client.query("SELECT erased_at IS NOT NULL AS dated FROM hunt_accounts WHERE account=$1",[retiredAccount])).rows[0].dated,true);
  await client.query("INSERT INTO oauth_artifacts VALUES('Interaction','new','{}',now()+interval '5 minutes')");
  await client.query(migration);
  assert.equal((await client.query("SELECT count(*) FROM oauth_artifacts")).rows[0].count,"1");
 } finally {
  await client.query("SET search_path TO public");
  await client.query("DROP SCHEMA "+migrationSchema+" CASCADE");
  client.release(); await pool.end();
 }
 const f = await authFixture(databaseUrl);
 try {
  const clockState=randomUUID(), realNow=Date.now;
  try {
   Date.now=()=>realNow()+3600000;
   await persistBrowserFlow(f.store.pool,clockState,{context:{stage:"login"}});
  } finally { Date.now=realNow; }
  const clockRow=(await f.store.pool.query("SELECT (data->>'initiatedAt')::numeric AS initiated_at,extract(epoch FROM clock_timestamp())*1000 AS database_now FROM oauth_browser_flows WHERE state=$1",[clockState])).rows[0];
  assert.ok(Math.abs(Number(clockRow.database_now)-Number(clockRow.initiated_at))<5000,"Browser starts use the database clock despite an application clock one hour ahead");
  await f.store.pool.query("DELETE FROM oauth_browser_flows WHERE state=$1",[clockState]);
  const login = await f.login();
  const principal = await f.authenticate(login.token);
  const scope = principal.agent, prefix=[scope.account,scope.incarnation];
  const caller={...scope,session:principal.session};
  const memory=new Memory(f.store.pool,f.issuer,false);
  const proposal={op:"profile",requestKey:randomUUID(),profile:{student:"unknown",cards:[],memberships:[]}};
  await memory.run(caller,proposal);
  await f.store.pool.query("UPDATE memory_commands SET expires_at=now()-interval '1 second' WHERE account=$1",[scope.account]);
  const maintenance=await maintainAccounts(f.store.pool);
  assert.equal(maintenance.proposalPayloads,1);
  const reserved=(await f.store.pool.query("SELECT command,key FROM memory_commands WHERE account=$1",[scope.account])).rows[0];
  assert.equal(reserved.command,null); assert.equal(reserved.key,proposal.requestKey);
  await assert.rejects(memory.run(caller,proposal),/expired/);
  await assert.rejects(memory.run(caller,{op:"read",collection:"saved",after:Buffer.from(JSON.stringify({account:randomUUID(),incarnation:scope.incarnation,collection:"saved",after:""})).toString("base64url")}),/scope mismatch/);
  const holder=await f.store.pool.connect(), observer=await f.store.pool.connect();
  let conflict;
  try {
  const inventoryStatus=createHash("sha256").update(randomUUID()).digest("hex");
  const addedSubject="inventory-"+randomUUID();
  const inventoryClient=new Proxy(holder,{get(target,key){
   if(key!=="query") return Reflect.get(target,key,target);
   return async(sql,values)=>{
    const result=await target.query(sql,values);
    if(sql==="SELECT issuer,subject FROM oauth_identities WHERE account=$1 AND incarnation=$2 ORDER BY issuer,subject") {
     await observer.query("BEGIN");
     try {
      await observer.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[JSON.stringify([f.config.upstreamIssuer,addedSubject])]);
      await observer.query("SELECT 1 FROM hunt_accounts WHERE account=$1 AND incarnation=$2 AND NOT erased FOR SHARE",prefix);
      await observer.query("INSERT INTO oauth_identities(issuer,subject,account,incarnation) VALUES($1,$2,$3,$4)",[f.config.upstreamIssuer,addedSubject,...prefix]);
      await observer.query("COMMIT");
     } catch(error) { await observer.query("ROLLBACK"); throw error; }
    }
    return result;
   };
  }});
  await holder.query("BEGIN");
  try {
   await holder.query("INSERT INTO erase_status(digest,operation) VALUES($1,$2)",[inventoryStatus,randomUUID()]);
   await assert.rejects(eraseAccount(inventoryClient,scope,f.config.lifecycleKey,f.config.lifecycleKeyVersion,inventoryStatus),{code:"40001",message:"Identity inventory changed"});
   assert.equal((await holder.query("SELECT erased FROM hunt_accounts WHERE account=$1 AND incarnation=$2",prefix)).rows[0].erased,false);
   assert.equal((await holder.query("SELECT count(*) FROM account_suppression WHERE account=$1",[scope.account])).rows[0].count,"0");
  } finally { await holder.query("ROLLBACK"); }
  await observer.query("DELETE FROM oauth_identities WHERE issuer=$1 AND subject=$2",[f.config.upstreamIssuer,addedSubject]);
  const crashed=await f.store.pool.connect();
  crashed.on("error",()=>{});
  try {
   await crashed.query("BEGIN");
   const status=createHash("sha256").update(randomUUID()).digest("hex");
   await crashed.query("INSERT INTO erase_status(digest,operation) VALUES($1,$2)",[status,randomUUID()]);
   await eraseAccount(crashed,scope,f.config.lifecycleKey,f.config.lifecycleKeyVersion,status);
   const pid=(await crashed.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
   assert.equal((await observer.query("SELECT pg_terminate_backend($1) AS terminated",[pid])).rows[0].terminated,true);
   await assert.rejects(crashed.query("COMMIT"));
  } finally { crashed.release(true); }
  await f.restart();
  assert.equal((await f.rpc(login.token,"tools/list")).status,200);
  assert.equal((await f.store.pool.query("SELECT count(*) FROM memory_commands WHERE account=$1",[scope.account])).rows[0].count,"1");
  const status=createHash("sha256").update(randomUUID()).digest("hex");
  await holder.query("BEGIN");
  await holder.query("SELECT 1 FROM hunt_accounts WHERE account=$1 AND incarnation=$2 AND NOT erased FOR UPDATE",prefix);
  const originalSubjectLock=await observer.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired",[JSON.stringify([f.config.upstreamIssuer,"upstream-subject-A"])]);
  assert.equal(originalSubjectLock.rows[0].acquired,true,"The original account-only fence does not block enrollment");
  await holder.query("ROLLBACK");
  await holder.query("BEGIN");
  await holder.query("INSERT INTO erase_status(digest,operation) VALUES($1,$2)",[status,randomUUID()]);
  await eraseAccount(holder,scope,f.config.lifecycleKey,f.config.lifecycleKeyVersion,status);
  const subjectLock=await observer.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired",[JSON.stringify([f.config.upstreamIssuer,"upstream-subject-A"])]);
  assert.equal(subjectLock.rows[0].acquired,false,"Enrollment must conflict with erasure at the subject lock");
  await holder.query("ROLLBACK");
  assert.equal((await f.rpc(login.token,"tools/list")).status,200);
  assert.equal((await f.store.pool.query("SELECT count(*) FROM memory_commands WHERE account=$1",[scope.account])).rows[0].count,"1");
  await holder.query("BEGIN");
  await holder.query("INSERT INTO erase_status(digest,operation) VALUES($1,$2)",[status,randomUUID()]);
  await eraseAccount(holder,scope,f.config.lifecycleKey,f.config.lifecycleKeyVersion,status);
  try { await observer.query("SELECT 1 FROM hunt_accounts WHERE account=$1 AND incarnation=$2 FOR SHARE NOWAIT",prefix); }
  catch(error) { conflict=error.code; }
  assert.equal(conflict,"55P03");
  const adapter=postgresAdapter(f.store.pool)("Interaction");
  const late=adapter.upsert("delayed-owned",{result:{login:{accountId:scope.account}}},300).then(()=>{throw new Error("Late write survived");},error=>error);
  await holder.query("COMMIT");
  assert.match((await late).message,/Inactive OAuth owner/);
  } finally { holder.release(); observer.release(); }
  await assert.rejects(memory.run(caller,{op:"read"}),/Inactive account/);
  assert.equal((await f.store.pool.query("SELECT count(*) FROM memory_commands WHERE account=$1",[scope.account])).rows[0].count,"0");
  await f.store.pool.query("UPDATE account_suppression SET purge_after=now()-interval '1 second' WHERE account=$1",[scope.account]);
  await f.store.pool.query("UPDATE hunt_accounts SET erased_at=now()-interval '32 days' WHERE account=$1",[scope.account]);
  await f.store.pool.query("UPDATE erase_status SET expires_at=now()-interval '1 second'");
  const purge=await maintainAccounts(f.store.pool);
  assert.equal(purge.account_suppression,1); assert.equal(purge.expiredAccounts,1); assert.equal(purge.erase_status,1);
  const other=await f.login("host-one","revoked-session");
  const otherPrincipal=await f.authenticate(other.token);
  await f.store.pool.query("DELETE FROM oauth_artifacts WHERE model='Session' AND payload->>'uid'=$1",[otherPrincipal.session]);
  await assert.rejects(memory.run({...otherPrincipal.agent,session:otherPrincipal.session},{op:"read"}),/Inactive OAuth session/);
  return {migration:{legacyArtifactRevoked:true,idempotent:true},expiry:{proposalPayloadRemoved:true,keyReserved:true,ledgerAndStatusPurged:true},rollback:true,backendCrashRollback:true,restart:true,lateWriteFence:true,enrollmentSubjectConflict:true,concurrentIdentityInventory:true,databaseFlowClock:true,conflict:{lock:"account",code:conflict},cachedRevokedSession:true};
 } finally { await f.close(); }
}
