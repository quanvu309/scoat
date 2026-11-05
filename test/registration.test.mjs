import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import pg from "pg";
import { postgresAdapter } from "../dist/auth/adapter.js";
import { authConfigSchema, chatgptRedirect } from "../dist/auth/config.js";
import { publicClient, registrationMetadata, registerClient } from "../dist/auth/registration.js";

const client = publicClient({ client_id: "scoat-chatgpt", redirect_uris: [chatgptRedirect] });
const minimal = { redirect_uris: [chatgptRedirect] };
const config = {
  issuer: "https://issuer.example", upstreamIssuer: "https://identity.example",
  upstreamClientId: "upstream", upstreamClientSecret: "fixture-only",
  lifecycleKey: "k".repeat(64), lifecycleKeyVersion: "test", cookieKeys: ["c".repeat(32)], jwks: { keys: [{}] },
  clients: [{ client_id: "codex", redirect_uris: ["https://codex.example/callback"] }, { client_id: client.client_id, redirect_uris: [chatgptRedirect] }],
};

test("registration selector is optional and rejects ambiguous or different clients", () => {
  assert.equal(authConfigSchema.parse(config).registrationClientId, undefined);
  const selected = { ...config, registrationClientId: client.client_id };
  assert.equal(authConfigSchema.parse(selected).clients[0].client_id, "codex");
  for (const value of [
    { ...selected, registrationClientId: "absent" },
    { ...selected, registrationClientId: "codex" },
    { ...selected, clients: [...config.clients, config.clients[1]] },
    { ...selected, clients: [...config.clients, { client_id: "other", redirect_uris: [chatgptRedirect] }] },
    { ...selected, clients: [{ ...config.clients[1], redirect_uris: [chatgptRedirect, "https://other.example/cb"] }] },
  ]) assert.equal(authConfigSchema.safeParse(value).success, false);
});

test("registration returns stable public metadata and ignores bounded display fields", () => {
  const expected = { ...client, scope: "openid scoat:read scoat:write" };
  assert.deepEqual(registrationMetadata(minimal, client), expected);
  assert.deepEqual(registrationMetadata(minimal, client), expected);
  assert.deepEqual(registrationMetadata({ ...minimal, token_endpoint_auth_method: "none", response_types: ["code"], grant_types: ["authorization_code"], application_type: "web", subject_type: "public", client_name: "Untrusted display name", client_uri: "https://unreachable.invalid", contacts: ["display@example.invalid"], software_id: "test", harmless_extension: "ignored", extension_list: ["bounded"] }, client), expected);
  assert.equal(registrationMetadata({ ...minimal, scope: "scoat:read" }, client).scope, "scoat:read");
  for (const key of ["client_secret", "registration_access_token", "registration_client_uri", "client_id_issued_at"]) assert.equal(key in expected, false);
});

test("registration rejects callback variations and security metadata", () => {
  for (const redirect_uris of [[], [chatgptRedirect, chatgptRedirect], [chatgptRedirect, "https://attacker.example/cb"], ...[
    chatgptRedirect + "/", chatgptRedirect + "?x=1", chatgptRedirect + "#x", chatgptRedirect.replace("https:", "http:"), chatgptRedirect.replace("chatgpt.com", "CHATGPT.COM"), chatgptRedirect.replace("chatgpt.com", "chatgpt.com.attacker.example"), chatgptRedirect.replace("chatgpt.com", "user@chatgpt.com"), "https://chatgpt.com/connector/oauth/abc",
  ].map(value => [value])]) assert.equal(registrationMetadata({ redirect_uris }, client).error, "invalid_redirect_uri");
  for (const extra of [
    { token_endpoint_auth_method: "client_secret_basic" }, { token_endpoint_auth_method: "private_key_jwt" },
    { grant_types: ["refresh_token"] }, { grant_types: ["client_credentials"] }, { grant_types: ["authorization_code", "refresh_token"] },
    { response_types: ["token"] }, { application_type: "native" }, { subject_type: "pairwise" },
    { scope: "offline_access" }, { scope: "scoat:read unknown" }, { scope: "scoat:read scoat:read" }, { scope: "" },
    { client_id: "codex" }, { client_secret: "secret" }, { software_statement: "unsigned" }, { jwks: {} }, { jwks_uri: "https://attacker.example/keys" },
    { request_uris: ["https://attacker.example"] }, { client_name: "x".repeat(1025) }, { contacts: [1] }, { unknown_extension: {} }, { unknown_extension: "x".repeat(1025) }, { request_object_signing_alg: "none" }, { dpop_bound_access_tokens: true },
  ]) assert.equal(registrationMetadata({ ...minimal, ...extra }, client).error, "invalid_client_metadata", JSON.stringify(extra));
  for (const value of [null, [], true, "json", 4]) assert.ok(registrationMetadata(value, client).error);
});

test("real HTTP registration has bounded JSON, precise refusals and no management endpoint", async () => {
  let metadataFetches = 0;
  const server = createServer((req, res) => {
    if (req.url === "/unfetched") {
      metadataFetches++;
      res.writeHead(404);
      res.end();
      return;
    }
    void registerClient(req, res, client);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/reg`;
  const post = (body, headers = { "content-type": "application/json" }) => fetch(endpoint, { method: "POST", headers, body });
  try {
    const registered = await Promise.all(Array.from({ length: 8 }, () => post(JSON.stringify(minimal))));
    for (const response of registered) {
      assert.equal(response.status, 201);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { ...client, scope: "openid scoat:read scoat:write" });
    }
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = await fetch(endpoint, { method });
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("allow"), "POST");
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.equal((await post(JSON.stringify(minimal), { "content-type": "application/json; charset=UTF-8" })).status, 201);
    assert.equal((await post("{}", { "content-type": "text/plain" })).status, 415);
    assert.equal((await post("{}", { "content-type": "application/json", "content-encoding": "gzip" })).status, 415);
    for (const body of ["", "{", "null", "[]", JSON.stringify({ ...minimal, scope: "offline_access" })]) {
      const response = await post(body);
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.ok((await response.json()).error);
    }
    const remote = await post(JSON.stringify({ ...minimal, logo_uri: `http://127.0.0.1:${address.port}/unfetched` }));
    assert.equal(remote.status, 201);
    assert.equal((await post(JSON.stringify({ ...minimal, jwks_uri: `http://127.0.0.1:${address.port}/unfetched` }))).status, 400);
    assert.equal(metadataFetches, 0);
    const encoded = JSON.stringify(minimal);
    assert.equal((await post(encoded + " ".repeat(8192 - Buffer.byteLength(encoded)))).status, 201);
    assert.equal((await post(" ".repeat(8193))).status, 413);
    assert.equal((await post(Buffer.from([0xff]))).status, 400);
    const chunked = await new Promise((resolve, reject) => {
      const req = request(endpoint, { method: "POST", headers: { "content-type": "application/json" } }, res => {
        res.resume();
        res.once("end", () => resolve(res.statusCode));
      });
      req.once("error", reject);
      req.write(" ".repeat(4096));
      req.end(" ".repeat(4097));
    });
    assert.equal(chunked, 413);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});


test("registration leaves the generic OAuth adapter expiry requirement intact", async () => {
  const pool = new pg.Pool();
  try {
    const adapter = postgresAdapter(pool)("Client");
    for (const expiry of [undefined, 0, -1, Infinity, 1.5]) await assert.rejects(adapter.upsert("unpersisted", {}, expiry), /bounded expiry/);
    assert.equal(pool.totalCount, 0);
  } finally {
    await pool.end();
  }
});
