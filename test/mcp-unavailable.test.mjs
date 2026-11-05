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
  const env = {};
  const fixture = await authFixture(databaseUrl, {
   env,
   async beforeStart({ databaseUrl }) {
    const connection = new URL(databaseUrl);
    connection.searchParams.set("options", connection.searchParams.get("options") + " -c statement_timeout=500ms");
    env.DATABASE_URL = connection.href;
    const probe = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 5000 });
    try {
     await probe.connect();
     const setting = await probe.query("SHOW statement_timeout");
     assert.equal(setting.rows[0].statement_timeout, "500ms", "fixture server connection must apply statement_timeout before acquiring the blocking lock");
     await assert.rejects(probe.query("SELECT pg_sleep(1)"), { code: "57014" }, "fixture server connection must cancel statements through PostgreSQL");
    } finally {
     await probe.end();
    }
   },
  });
  let holder;
  try {
   const login = await fixture.login();
   const params = {name:"scoat_card",arguments:{op:"open",hunt:"absent"}};
   const healthy = await fixture.rpc(login.token,"tools/call",params);
   assert.equal(healthy.status,200);
   assert.equal(healthy.body.result.structuredContent.error.code,"revoked");
   holder = await fixture.store.pool.connect();
   await holder.query("BEGIN");
   await holder.query("LOCK TABLE oauth_read_grants IN ACCESS EXCLUSIVE MODE");
   const response = await fetch(fixture.issuer + "/mcp", {
    method: "POST",
    headers: {
     "content-type": "application/json",
     accept: "application/json, text/event-stream",
     "mcp-protocol-version": "2025-11-25",
     authorization: "Bearer " + login.token,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params }),
    signal: AbortSignal.timeout(5000),
   }).catch(error => assert.fail("locked tool call must return HTTP 503 within 5s; verify the fixture server statement_timeout: " + error.name));
   assert.equal(response.status,503);
   const body = await response.json();
   assert.deepEqual(body,{error:"service_unavailable"});
   assert.doesNotMatch(JSON.stringify(body),/statement|timeout|oauth_read_grants|SELECT|canceling|57014/i);
  } finally {
   if (holder) { await holder.query("ROLLBACK"); holder.release(); }
   await fixture.close();
  }
 });
});
