import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { databaseUnavailable, DatabaseUnavailable } from "../dist/db/unavailable.js";
import { ContractBreach } from "../dist/mcp/results.js";
import { withDatabase } from "../scripts/durable-database.mjs";
import { authFixture } from "../scripts/auth-fixture.mjs";

test("only database availability failures are classified as infrastructure", () => {
 for (const code of ["08006", "57014", "57P01", "53300"]) {
  const error = new pg.DatabaseError("private driver detail", 0, "error");
  error.code = code;
  assert.ok(databaseUnavailable(error) instanceof DatabaseUnavailable);
 }
 for (const error of [new Error("bug"), new TypeError("bug"), new ContractBreach(), Object.assign(new pg.DatabaseError("bad SQL", 0, "error"), {code:"42601"}), Object.assign(new Error("constraint"), {code:"23505"})]) assert.equal(databaseUnavailable(error), null);
 assert.ok(databaseUnavailable(Object.assign(new Error("private"), {code:"ECONNRESET"})) instanceof DatabaseUnavailable);
 assert.ok(databaseUnavailable(new Error("Connection terminated unexpectedly")) instanceof DatabaseUnavailable);
});

test("post-authentication PostgreSQL statement timeout returns sanitized HTTPS 503", async () => {
 await withDatabase(async databaseUrl => {
  const fixture = await authFixture(databaseUrl);
  let holder;
  try {
   await fixture.store.pool.query("ALTER DATABASE postgres SET statement_timeout='500ms'");
   await fixture.restart();
   const login = await fixture.login();
   const params = {name:"scoat_card",arguments:{op:"open",hunt:"absent"}};
   const healthy = await fixture.rpc(login.token,"tools/call",params);
   assert.equal(healthy.status,200);
   assert.equal(healthy.body.result.structuredContent.error.code,"revoked");
   holder = await fixture.store.pool.connect();
   await holder.query("BEGIN");
   await holder.query("LOCK TABLE oauth_read_grants IN ACCESS EXCLUSIVE MODE");
   const timedOut = await fixture.rpc(login.token,"tools/call",params);
   assert.equal(timedOut.status,503);
   assert.deepEqual(timedOut.body,{error:"service_unavailable"});
   assert.doesNotMatch(JSON.stringify(timedOut.body),/statement|timeout|oauth_read_grants|SELECT|canceling|57014/i);
  } finally {
   if (holder) { await holder.query("ROLLBACK"); holder.release(); }
   await fixture.close();
  }
 });
});
