import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, request } from "node:http";
import pg from "pg";
import { postgresAdapter } from "../dist/auth/adapter.js";
import { authConfigSchema, chatgptRedirect } from "../dist/auth/config.js";
import { publicClient, RegisteredClients, registerClient } from "../dist/auth/registration.js";

const client = publicClient({ client_id: "scoat-chatgpt", redirect_uris: [chatgptRedirect] });
const minimal = { redirect_uris: [chatgptRedirect] };
const config = {
  issuer: "https://issuer.example", upstreamIssuer: "https://identity.example",
  upstreamClientId: "upstream", upstreamClientSecret: "fixture-only",
  lifecycleKey: "k".repeat(64), lifecycleKeyVersion: "test", cookieKeys: ["c".repeat(32)], jwks: { keys: [{}] },
  clients: [{ client_id: "codex", redirect_uris: ["https://codex.example/callback"] }, { client_id: client.client_id, redirect_uris: [chatgptRedirect] }],
};
const selected = { ...config, registrationClientId: client.client_id, registrationKeys: [{ version: "first", secret: "r".repeat(64) }] };
const clients = new RegisteredClients(authConfigSchema.parse(selected));
const registrationMetadata = raw => clients.metadata(raw);

test("registration selector is optional and rejects ambiguous or different clients", () => {
  assert.equal(authConfigSchema.parse(config).registrationClientId, undefined);
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
  const expected = { ...client, scope: "openid offline_access scoat:read scoat:write" };
  assert.deepEqual(registrationMetadata(minimal, client), expected);
  assert.deepEqual(registrationMetadata(minimal, client), expected);
  assert.deepEqual(registrationMetadata({ ...minimal, token_endpoint_auth_method: "none", response_types: ["code"], grant_types: ["authorization_code"], application_type: "web", subject_type: "public", client_name: "Untrusted display name", client_uri: "https://unreachable.invalid", contacts: ["display@example.invalid"], software_id: "test", harmless_extension: "ignored", extension_list: ["bounded"] }, client), expected);
  assert.equal(registrationMetadata({ ...minimal, scope: "scoat:read" }, client).scope, "scoat:read");
  for (const key of ["client_secret", "registration_access_token", "registration_client_uri", "client_id_issued_at"]) assert.equal(key in expected, false);
});

test("registration rejects callback variations and security metadata", () => {
  for (const redirect_uris of [[], [chatgptRedirect, chatgptRedirect], [chatgptRedirect, "https://attacker.example/cb"], ...[
    chatgptRedirect + "/", chatgptRedirect + "?x=1", chatgptRedirect + "#x", chatgptRedirect.replace("https:", "http:"), chatgptRedirect.replace("chatgpt.com", "CHATGPT.COM"), chatgptRedirect.replace("chatgpt.com", "chatgpt.com.attacker.example"), chatgptRedirect.replace("chatgpt.com", "user@chatgpt.com"),
  ].map(value => [value])]) assert.equal(registrationMetadata({ redirect_uris }, client).error, "invalid_redirect_uri");
  for (const extra of [
    { token_endpoint_auth_method: "client_secret_basic" }, { token_endpoint_auth_method: "private_key_jwt" },
    { grant_types: ["refresh_token"] }, { grant_types: ["client_credentials"] },
    { response_types: ["token"] }, { application_type: "native" }, { subject_type: "pairwise" },
    { scope: "scoat:read unknown" }, { scope: "scoat:read scoat:read" }, { scope: "" },
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
    void registerClient(req, res, clients);
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
      assert.deepEqual(await response.json(), { ...client, scope: "openid offline_access scoat:read scoat:write" });
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
    for (const body of ["", "{", "null", "[]", JSON.stringify({ ...minimal, scope: "unsupported" })]) {
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

test("documented connection-specific ChatGPT callback can register", () => {
  const result = registrationMetadata({ redirect_uris: ["https://chatgpt.com/connector/oauth/connection_123"] }, client);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.redirect_uris, ["https://chatgpt.com/connector/oauth/connection_123"]);
});


test("callback-bound clients are deterministic, issuer-bound and immutable across key rotation", async () => {
  const redirect = "https://chatgpt.com/connector/oauth/connection_123";
  const raw = { redirect_uris: [redirect], grant_types: ["authorization_code", "refresh_token"] };
  const result = clients.metadata(raw);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.grant_types, ["authorization_code", "refresh_token"]);
  assert.equal(result.token_endpoint_auth_method, "none");
  assert.deepEqual(clients.metadata(raw), result);
  assert.ok(result.client_id.length <= 200);
  const { scope, ...resolved } = result;
  assert.deepEqual(clients.resolve(result.client_id), resolved);
  const second = clients.metadata({ redirect_uris: [redirect + "other"] });
  assert.notEqual(second.client_id, result.client_id);
  assert.deepEqual(clients.resolve(second.client_id).redirect_uris, [redirect + "other"]);
  const otherIssuer = new RegisteredClients(authConfigSchema.parse({ ...selected, issuer: "https://other.example" }));
  assert.equal(otherIssuer.resolve(result.client_id), undefined);
  const rotated = new RegisteredClients(authConfigSchema.parse({ ...selected, cookieKeys: ["new-cookie".repeat(8)], lifecycleKey: "changed".repeat(10), registrationKeys: [{ version: "second", secret: "s".repeat(64) }, ...selected.registrationKeys] }));
  assert.deepEqual(rotated.resolve(result.client_id), resolved);
  assert.notEqual(rotated.metadata(raw).client_id, result.client_id);
  const retired = new RegisteredClients(authConfigSchema.parse({ ...selected, registrationKeys: [{ version: "second", secret: "s".repeat(64) }] }));
  assert.equal(retired.resolve(result.client_id), undefined);
  for (const id of [result.client_id.slice(0,-1), result.client_id + "x", result.client_id.replace("v1.","v2."), result.client_id.replace("connection_123", "connection_124"), result.client_id.slice(0,-1) + (result.client_id.endsWith("A") ? "B" : "A"), "unknown"]) assert.equal(clients.resolve(id), undefined);
  const adapter = clients.adapter();
  assert.deepEqual(await adapter.find(result.client_id), resolved);
  assert.equal(await adapter.find("unknown"), undefined);
  assert.equal(await adapter.findByUid(result.client_id), undefined);
  assert.equal(await adapter.findByUserCode(result.client_id), undefined);
  for (const op of ["upsert", "destroy", "consume", "revokeByGrantId"]) await assert.rejects(adapter[op](result.client_id, {}, 3600), /immutable and stateless/);
});

test("connection callbacks reject normalization, foreign hosts and callback sets", () => {
  const base = "https://chatgpt.com/connector/oauth/";
  for (const uri of [base, base + "x/", base + "x/y", base + "..", base + "%41", base + "%2e%2e", base + "x?foo=bar", base + "x#bar", base + "*", base + "中文", base + "x".repeat(129), base.replace("https:", "http:") + "x", base.replace("chatgpt.com", "CHATGPT.COM") + "x", base.replace("chatgpt.com", "chatgpt.com:443") + "x", base.replace("chatgpt.com", "user@chatgpt.com") + "x", base.replace("chatgpt.com", "chatgpt.com.evil.example") + "x"]) assert.equal(clients.metadata({ redirect_uris: [uri] }).error, "invalid_redirect_uri", uri);
  assert.equal(clients.metadata({ redirect_uris: [chatgptRedirect, base + "x"] }).error, "invalid_redirect_uri");
  const longest = clients.metadata({ redirect_uris: [base + "x".repeat(128)] });
  assert.equal(longest.error, undefined);
  assert.ok(longest.client_id.length <= 200);
  const { scope, ...resolved } = longest;
  assert.deepEqual(clients.resolve(longest.client_id), resolved);
  for (const change of [{ registrationKeys: undefined }, { registrationKeys: [selected.registrationKeys[0], selected.registrationKeys[0]] }, { clients: [{ client_id: "scoat-cb.v1.spoof", redirect_uris: [chatgptRedirect] }] }]) assert.equal(authConfigSchema.safeParse({ ...selected, ...change }).success, false);
});

test("refusal diagnostics expose bounded field names and no attacker values", () => {
  const raw = { redirect_uris: ["https://secret.example/private"], client_secret: "never-print-this", token_endpoint_auth_method: "client_secret_basic", arbitrary: { secret: "hidden" } };
  const diagnostic = clients.refusal(raw);
  assert.deepEqual(diagnostic, { event: "oauth_registration_refused", fields: ["client_secret", "extension", "redirect_uris", "token_endpoint_auth_method"] });
  const json = JSON.stringify(diagnostic);
  for (const secret of ["never-print-this", "secret.example", "hidden", "arbitrary"]) assert.equal(json.includes(secret), false);
  assert.equal(clients.refusal(minimal), undefined);
});


test("Claude hosted and native callbacks register with refresh grants", () => {
  for (const redirect of ["https://claude.ai/api/mcp/auth_callback", "http://localhost:54321/callback", "http://127.0.0.1:54322/callback"]) {
    const result = clients.metadata({ redirect_uris: [redirect], scope: "openid offline_access scoat:read scoat:write" });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.grant_types, ["authorization_code", "refresh_token"]);
    assert.deepEqual(clients.resolve(result.client_id).redirect_uris, [redirect]);
  }
});


test("existing v1 IDs retain their original signing contract", () => {
  const redirect = "https://chatgpt.com/connector/oauth/existing_connection";
  const mac = createHmac("sha256", selected.registrationKeys[0].secret).update(JSON.stringify(["scoat-chatgpt-client-v1", selected.issuer, client.client_id, redirect])).digest("base64url");
  const id = `scoat-cb.v1.first.existing_connection.${mac}`;
  assert.deepEqual(clients.resolve(id), publicClient({ client_id: id, redirect_uris: [redirect] }));
});

test("Claude v2 IDs bind callback, host, issuer and retained registration keys", () => {
  const rotated = new RegisteredClients(authConfigSchema.parse({ ...selected, registrationKeys: [{ version: "second", secret: "s".repeat(64) }, ...selected.registrationKeys] }));
  const retired = new RegisteredClients(authConfigSchema.parse({ ...selected, registrationKeys: [{ version: "second", secret: "s".repeat(64) }] }));
  const foreign = new RegisteredClients(authConfigSchema.parse({ ...selected, issuer: "https://other.example" }));
  for (const redirect of ["https://claude.ai/api/mcp/auth_callback", "http://localhost:54321/callback", "http://127.0.0.1:54322/callback"]) {
    const raw = { redirect_uris: [redirect] };
    const result = clients.metadata(raw);
    const { scope, ...resolved } = result;
    assert.deepEqual(clients.metadata(raw), result);
    assert.match(result.client_id, /^scoat-cb\.v2\./);
    assert.deepEqual(rotated.resolve(result.client_id), resolved);
    assert.notEqual(rotated.metadata(raw).client_id, result.client_id);
    assert.equal(retired.resolve(result.client_id), undefined);
    assert.equal(foreign.resolve(result.client_id), undefined);
    for (const id of [result.client_id + "x", result.client_id.replace(".claude.", ".claude-code."), result.client_id.replace(".claude-code.", ".claude."), result.client_id.replace(Buffer.from(redirect).toString("base64url"), Buffer.from(redirect + "/other").toString("base64url"))].filter(id => id !== result.client_id)) assert.equal(clients.resolve(id), undefined);
  }
  for (const redirect of ["http://localhost:65536/callback", "http://localhost:0/callback", "http://127.0.0.1:1234/callback?x=1", "http://localhost.evil.example:1234/callback", "https://claude.ai/api/mcp/auth_callback/", "https://claude.ai:443/api/mcp/auth_callback"]) assert.equal(clients.metadata({ redirect_uris: [redirect] }).error, "invalid_redirect_uri");
});
