import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { launch, connect } from "../scripts/driver.mjs";
import { toolCatalog, dispatch, schemas } from "../dist/mcp/index.js";

test("HTTP transport rejects foreign Origins and accepts native and loopback clients", async () => {
  const server = await launch();
  async function status(origin?: string) {
    return await new Promise<number>((resolve, reject) => {
      const req = request(new URL("/mcp", server.base), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(origin === undefined ? {} : { origin }) }
      }, res => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); res.on("error", reject); });
      req.on("error", reject);
      req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
    });
  }
  try {
    assert.equal(await status("https://attacker.invalid"), 403);
    assert.equal(await status("null"), 403);
    assert.equal(await status(), 200);
    const port = new URL(server.base).port;
    assert.equal(await status(`http://127.0.0.1:${port}`), 200);
    assert.equal(await status(`http://localhost:${port}`), 200);
    assert.equal(await status("http://127.0.0.1:1"), 403);
  } finally { await server.close(); }
  assert.deepEqual(server.logs, []);
});

test("strict schemas reject forged identities and totals before dispatch", () => {
  for (const field of ["account", "person", "actor", "total", "payToday"]) {
    assert.throws(() => dispatch("scoat_hunt", { op: "list", [field]: "forged" }));
  }
  assert.throws(() => dispatch("scoat_memory", { op: "watch", hunt: "h", requestKey: "k", target: { currency: "USD", pence: 1 } }));
  assert.throws(() => dispatch("scoat_memory", { op: "watch", hunt: "h", requestKey: "k", target: { currency: "GBP", pence: 1.5 } }));
  assert.throws(() => dispatch("scoat_memory", { op: "watch", hunt: "h", requestKey: "k", target: { currency: "GBP", pence: 1, total: 0 } }));
});
test("prompts reject unexpected arguments before rendering and preserve valid guidance", async () => {
  const server = await launch();
  let client;
  try {
    client = await connect(server.base);
    assert.deepEqual((await client.listPrompts()).prompts.map(prompt => prompt.name), ["hunt-best-benefit"]);
    const prompt = await client.getPrompt({ name: "hunt-best-benefit", arguments: { shop: "nike" } });
    const guide = await client.callTool({ name: "scoat_guide", arguments: { job: "best-benefit", shop: "nike" } });
    assert.equal(prompt.messages[0].content.text, guide.content[0].text);
    assert.equal((await client.getPrompt({ name: "hunt-best-benefit" })).messages.length, 1);
    for (const field of ["identity", "account", "person", "total"]) await assert.rejects(client.getPrompt({ name: "hunt-best-benefit", arguments: { shop: "nike", [field]: "forged" } }), error => error.code === -32602);
    await assert.rejects(client.getPrompt({ name: "unknown" }), error => error.code === -32602);
  } finally { if (client) await client.close(); await server.close(); }
  assert.deepEqual(server.logs, []);
});
test("ordinary HTTP client sees app-only tool but cannot authorize it", async () => {
  const server = await launch();
  let client;
  try {
    client = await connect(server.base);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), Object.keys(toolCatalog).sort());
    for (const tool of listed.tools) assert.deepEqual(tool.inputSchema, schemas()[tool.name]);
    assert.deepEqual(listed.tools.find(tool => tool.name === "scoat_card")._meta.ui.visibility, ["app"]);
    const result = await client.callTool({ name: "scoat_card", arguments: { op: "act", hunt: "h", grant: "arbitrary", requestKey: "k", action: { kind: "stop" } } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    const invalid = await client.callTool({ name: "scoat_hunt", arguments: { op: "list", account: "forged" } });
    assert.equal(invalid.isError, true);
    assert.equal(invalid.structuredContent, undefined);
    const guide = await client.callTool({ name: "scoat_guide", arguments: { job: "best-benefit", shop: null } });
    assert.equal(guide.structuredContent.ok, true);
    assert.equal(guide.structuredContent.rows.length, 8);
  } finally { if (client) await client.close(); await server.close(); }
  assert.deepEqual(server.logs, []);
  assert.equal("person" in await import("../dist/mcp/index.js"),false);
});
test("pinned SDK exposes app-only metadata to an ordinary raw Client", async () => {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { registerAppTool } = await import("@modelcontextprotocol/ext-apps/server");
  const { z } = await import("zod");
  const server = new McpServer({ name: "isolated-visibility-probe", version: "1" });
  let calls = 0;
  registerAppTool(server, "scoat_card", { inputSchema: z.strictObject({}), _meta: { ui: { visibility: ["app"] } } }, async () => { calls += 1; return { content: [{ type: "text", text: "fixture only" }], _meta: { fixtureValue: "synthetic-not-a-grant" } }; });
  const client = new Client({ name: "raw-probe", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(left); await client.connect(right);
    assert.equal((await client.listTools()).tools.length, 1);
    const result = await client.callTool({ name: "scoat_card", arguments: {} });
    assert.equal(calls, 1);
    assert.equal(result._meta.fixtureValue, "synthetic-not-a-grant");
  } finally { await client.close(); await server.close(); }
});
