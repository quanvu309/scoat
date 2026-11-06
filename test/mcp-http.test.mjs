import test from "node:test";
import assert from "node:assert/strict";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../dist/mcp/index.js";
import { handleMcpRequest, logMcpResponse, modernProtocol } from "../dist/mcp/http.js";
import { withDatabase } from "../scripts/durable-database.mjs";
import { authFixture } from "../scripts/auth-fixture.mjs";

function request(method, params = {}, changes = {}) {
 const body = { jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": modernProtocol, "io.modelcontextprotocol/clientCapabilities": {} } } };
 const headers = { host: "localhost", "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": modernProtocol, "mcp-method": method, ...(params.name ? { "mcp-name": params.name } : {}), ...changes };
 return { body, request: new Request("http://localhost/mcp", { method: "POST", headers, body: JSON.stringify(body) }) };
}

async function dispatch(input, adapt = true) {
 const server = createMcpServer();
 const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, enableDnsRebindingProtection: true, allowedHosts: ["localhost"], allowedOrigins: ["http://localhost"] });
 try {
  await server.connect(transport);
  const handle = req => transport.handleRequest(req, { parsedBody: input.body });
  const response = await (adapt ? handleMcpRequest(input.request, input.body, handle) : handle(input.request));
  return { status: response.status, body: await response.json() };
 } finally { await transport.close(); await server.close(); }
}

test("modern first tool request succeeds without initialize; the pinned transport reproduces production's 198-byte 400", async () => {
 const params = { name: "scoat_guide", arguments: { job: "best-benefit", shop: null } };
 const original = await dispatch(request("tools/call", params), false);
 assert.equal(original.status, 400);
 assert.equal(Buffer.byteLength(JSON.stringify(original.body)), 198);
 const fixed = await dispatch(request("tools/call", params));
 assert.equal(fixed.status, 200);
 assert.equal(fixed.body.result.isError, false);
 assert.equal(fixed.body.result.structuredContent.ok, true);
 assert.equal(fixed.body.result.resultType, "complete");
 assert.equal(fixed.body.result._meta["io.modelcontextprotocol/serverInfo"].name, "scoat-foundation");
 assert.ok(fixed.body.result.content[0].text.length > 1000);
 const jsonOnly = await dispatch(request("tools/call", params, { accept: "application/json" }));
 assert.equal(jsonOnly.status, 200);
 assert.equal(jsonOnly.body.result.isError, false);
});

test("modern discovery and errors preserve protocol negotiation and transport security", async () => {
 const discovery = await dispatch(request("server/discover"));
 assert.equal(discovery.status, 200);
 assert.ok(discovery.body.result.supportedVersions.includes(modernProtocol));
 assert.deepEqual(discovery.body.result.capabilities, { tools: {}, resources: {}, prompts: {} });
 const mismatch = await dispatch(request("ping", {}, { "mcp-method": "tools/call" }));
 assert.equal(mismatch.status, 400);
 assert.equal(mismatch.body.error.code, -32020);
 const future = request("ping", {}, { "mcp-protocol-version": "2099-01-01" });
 future.body.params._meta["io.modelcontextprotocol/protocolVersion"] = "2099-01-01";
 const unsupported = await dispatch(future);
 assert.equal(unsupported.status, 400);
 assert.equal(unsupported.body.error.code, -32022);
 const foreign = await dispatch(request("ping", {}, { origin: "https://foreign.invalid" }));
 assert.equal(foreign.status, 403);
 const missing = await dispatch(request("unsupported/method"));
 assert.equal(missing.status, 404);
 assert.equal(missing.body.error.code, -32601);
 const invalid = await dispatch(request("tools/call", { name: "scoat_guide", arguments: { secret: "private" } }));
 assert.equal(invalid.status, 200);
 assert.equal(invalid.body.result.isError, true);
 assert.doesNotMatch(JSON.stringify(invalid.body), /private/);
});

test("legacy stateless clients retain their response envelope", async () => {
 const input = request("ping", {}, { "mcp-protocol-version": "2025-11-25" });
 delete input.body.params._meta;
 const legacy = await dispatch(input);
 assert.equal(legacy.status, 200);
 assert.deepEqual(legacy.body.result, {});
});

test("diagnostics never echo arbitrary headers, methods, ids, errors or tool content", () => {
 const logs = [];
 logMcpResponse("secret-header", { id: "secret-id", method: "secret-method", params: { token: "secret-token" } }, 400, { error: { code: -32000, message: "secret-driver" } }, line => logs.push(line));
 logMcpResponse(modernProtocol, { method: "tools/call" }, 200, { result: { isError: true, content: [{ text: "secret-content" }] } }, line => logs.push(line));
 assert.doesNotMatch(logs.join(""), /secret/);
 assert.equal(JSON.parse(logs[0]).message, "Transport refused");
 assert.equal(JSON.parse(logs[1]).isError, true);
 assert.ok(logs.every(line => line.length < 512));
});

test("authenticated modern calls return useful guide and account hunt results on the real HTTPS boundary", async () => {
 await withDatabase(async databaseUrl => {
  const fixture = await authFixture(databaseUrl);
  try {
   const login = await fixture.login();
   for (const params of [{ name: "scoat_guide", arguments: { job: "best-benefit", shop: null } }, { name: "scoat_hunt", arguments: { op: "list" } }]) {
    const input = request("tools/call", params);
    const response = await fetch(fixture.issuer + "/mcp", { method: "POST", headers: { ...Object.fromEntries([...input.request.headers].filter(([name]) => name !== "host")), authorization: "Bearer " + login.token }, body: JSON.stringify(input.body) });
    assert.equal(response.status, 200);
    const reply = await response.json();
    assert.equal(reply.result.isError, false);
    assert.equal(reply.result.structuredContent.ok, true);
    assert.equal(reply.result.resultType, "complete");
    assert.ok(reply.result.content[0].text.length > 0);
   }
  } finally { await fixture.close(); }
 });
});
