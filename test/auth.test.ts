import test from "node:test";
import assert from "node:assert/strict";
import { withDatabase } from "../scripts/durable-database.mjs";
import { authFixture } from "../scripts/auth-fixture.mjs";

test("maintained issuer authenticates two clients to the same durable subject", async () => {
  await withDatabase(async (databaseUrl: string) => {
    const f = await authFixture(databaseUrl);
    try {
      const one = await f.login();
      const two = await f.login("host-two");
      assert.equal((await f.rpc(one.token, "tools/list")).status, 200);
      assert.equal((await f.rpc(two.token, "tools/list")).status, 200);
      const identities = await f.store.pool.query(
        "SELECT count(*) FROM oauth_identities",
      );
      assert.equal(identities.rows[0].count, "1");
      assert.equal((await f.rpc("forged", "tools/list")).status, 401);
      const wrong = await f.link(
        "unlinked-subject",
        "upstream-subject-A",
      );
      assert.equal(wrong.status, 400);
      const revoke = await fetch(f.issuer + "/token/revocation", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: "host-one", token: one.token }),
      });
      assert.equal(revoke.status, 200);
      assert.equal((await f.rpc(one.token, "tools/list")).status, 401);
      assert.equal((await f.rpc(two.token, "tools/list")).status, 200);
      const discovery = await (
        await fetch(f.issuer + "/.well-known/oauth-authorization-server")
      ).json();
      assert.equal(discovery.issuer, f.issuer);
      assert.equal(discovery.registration_endpoint, undefined);
      assert.deepEqual(discovery.code_challenge_methods_supported, ["S256"]);
    } finally {
      await f.close();
    }
  });
});

test("compiled production fails closed without issuer configuration", async () => {
  const { createHttpServer } = await import("../dist/server.js");
  const prior = process.env.SCOAT_AUTH_CONFIG;
  delete process.env.SCOAT_AUTH_CONFIG;
  const server = await createHttpServer();
  if (prior !== undefined) process.env.SCOAT_AUTH_CONFIG = prior;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    assert.equal(
      (await fetch(`http://127.0.0.1:${address.port}/healthz`)).status,
      503,
    );
    assert.equal(
      (await fetch(`http://127.0.0.1:${address.port}/mcp`, { method: "POST" }))
        .status,
      503,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
