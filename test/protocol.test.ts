import test from "node:test";
import assert from "node:assert/strict";
import { launch, connect } from "../scripts/driver.mjs";
import { toolCatalog, dispatch, person, schemas } from "../dist/mcp/index.js";

test("strict schemas reject forged identities and totals before dispatch", () => {
  for (const field of ["account", "person", "actor", "total", "payToday"]) {
    assert.throws(() => dispatch("scoat_hunt", { op: "list", [field]: "forged" }));
  }
  assert.throws(() => dispatch("scoat_memory", { op: "watch", hunt: "h", requestKey: "k", target: { currency: "USD", pence: 1 } }));
  assert.throws(() => dispatch("scoat_memory", { op: "watch", hunt: "h", requestKey: "k", target: { currency: "GBP", pence: 1.5 } }));
  assert.throws(() => dispatch("scoat_memory", { op: "watch", hunt: "h", requestKey: "k", target: { currency: "GBP", pence: 1, total: 0 } }));
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
    assert.equal(result.structuredContent.error.code, "forbidden");
    const invalid = await client.callTool({ name: "scoat_hunt", arguments: { op: "list", account: "forged" } });
    assert.equal(invalid.isError, true);
    assert.equal(invalid.structuredContent, undefined);
    const guide = await client.callTool({ name: "scoat_guide", arguments: { job: "best-benefit", shop: null } });
    assert.equal(guide.structuredContent.error.code, "unavailable");
  } finally { if (client) await client.close(); await server.close(); }
  assert.deepEqual(server.logs, []);
  await assert.rejects(person({ grant: "arbitrary", hunt: "h" }), /authorization unavailable/);
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
