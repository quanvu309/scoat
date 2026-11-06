import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { z } from "zod";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListToolsRequestSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer, descriptors, toolCatalog, parseToolCall } from "../dist/mcp/index.js";
import { conform, ContractBreach, repairFor, refusal, refuseInput } from "../dist/mcp/results.js";
import { wireSchema } from "../dist/mcp/schema.js";
import { checkCardOutputContract, checkMemoryContract, checkOutputContract, checkToolDescriptors } from "../scripts/check-structure.mjs";

async function withClient(run, invoke, advertised) {
 const server = createMcpServer(invoke);
 if (advertised) server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: advertised }));
 const client = new Client({ name: "native-contract-probe", version: "1" });
 const [left, right] = InMemoryTransport.createLinkedPair();
 try { await server.connect(left); await client.connect(right); await client.listTools(); await run(client); }
 finally { await client.close(); await server.close(); }
}
test("MCP Apps resource metadata declares a lean isolated inline card", async () => {
 await withClient(async client => {
  const tools=(await client.listTools()).tools;
  assert.equal(tools.length,4);
  assert.equal(tools.find(tool=>tool.name==="scoat_hunt")._meta.ui.resourceUri,"ui://scoat/hunt.html");
  for(const tool of tools.filter(tool=>tool.name!=="scoat_hunt")) assert.equal(tool._meta.ui.resourceUri,undefined);
  assert.deepEqual(tools.find(tool=>tool.name==="scoat_card")._meta.ui.visibility,["app"]);
  const resource=await client.readResource({uri:"ui://scoat/hunt.html"});
  assert.equal(resource.contents.length,1);
  assert.equal(resource.contents[0].mimeType,"text/html;profile=mcp-app");
  assert.deepEqual(resource.contents[0]._meta.ui,{prefersBorder:false,csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]}});
 });
});
function parity(result) {
 assert.equal(result.content.at(-1).text, JSON.stringify(result.structuredContent));
 assert.equal(result.isError === true, result.structuredContent.ok === false);
}
test("discovery survives pinned SDK parsing with complete schemas and input defaults", () => {
 assert.deepEqual(ListToolsResultSchema.parse({ tools: descriptors() }).tools, descriptors());
 assert.deepEqual(descriptors().find(tool => tool.name === "scoat_memory").inputSchema.oneOf.find(branch => branch.properties.op.const === "read").required, ["op"]);
});
test("every published input and output compiles under draft-7 and 2020-12", () => {
 const tuple = z.toJSONSchema(z.strictObject({ values: z.tuple([z.string()]).rest(z.string()) }), { target: "draft-7" });
 assert.equal(new Ajv({ strict: false }).validateSchema(tuple), true);
 assert.equal(new Ajv2020({ strict: false }).validateSchema({ ...tuple, $schema: "https://json-schema.org/draft/2020-12/schema" }), false);
 for (const [validator, dialect] of [[new Ajv({ strict: false }), "http://json-schema.org/draft-07/schema#"], [new Ajv2020({ strict: false }), "https://json-schema.org/draft/2020-12/schema"]]) {
  addFormats(validator);
  for (const tool of descriptors()) for (const key of ["inputSchema", "outputSchema"]) {
   const schema = { ...tool[key], $schema: dialect };
   assert.equal(validator.validateSchema(schema), true, `${tool.name}.${key}: ${JSON.stringify(validator.errors)}`);
   const validate = validator.compile(schema);
   if (key === "inputSchema" && tool.name === "scoat_hunt") {
    assert.equal(validate({ op: "start", requestKey: "mouse-1", intent: { product: "Logitech M185 wireless mouse" } }), true);
    assert.equal(validate({ op: "start", requestKey: "mouse-1", intent: { product: { name: "mouse" } } }), false);
   }
  }
  const validate = validator.compile({ ...wireSchema(z.strictObject({ values: z.tuple([z.string()]).rest(z.string()) }), { io: "output" }), $schema: dialect });
  assert.equal(validate({ values: ["first", "second"] }), true);
  assert.equal(validate({ values: [] }), false);
  assert.equal(validate({ values: ["first", 2] }), false);
 }
 assert.throws(() => wireSchema(z.strictObject({ values: z.tuple([z.string(), z.number()]) }), { io: "output" }), /homogeneous/);
});
test("a plain product string starts with saved profile defaults and actionable input repair", async () => {
 const arguments_ = { op: "start", requestKey: "mouse-1", intent: { product: "Logitech M185 wireless mouse" } };
 const call = parseToolCall("scoat_hunt", arguments_);
 assert.deepEqual(call.input.intent, { product: { kind: "description", text: "Logitech M185 wireless mouse" }, variant: null, shop: null, budget: null });
 assert.equal(call.input.profile, null);
 assert.deepEqual(call, parseToolCall("scoat_hunt", { ...arguments_, intent: { product: { kind: "description", text: "Logitech M185 wireless mouse" } } }));
 await withClient(async client => {
  const result = await client.callTool({ name: "scoat_hunt", arguments: { ...arguments_, intent: { product: { name: "PRIVATE-PRODUCT" } } } });
  assert.match(result.content[0].text, /intent\.product: expected a nonempty product name string/);
  assert.equal(JSON.stringify(result).includes("PRIVATE-PRODUCT"), false);
 });
});
test("pinned client validates safe input refusals and fixture denials", async () => {
 await withClient(async client => {
  await assert.rejects(client.callTool({ name: "scoat_search" }), error => error.code === -32602);
  const result = await client.callTool({ name: "scoat_hunt", arguments: { op: "list", account: "SECRET-XYZ" } });
  parity(result);
  assert.equal(result.structuredContent.error.code, "invalid-input");
  assert.deepEqual(result.structuredContent.error.repair.issues, [{ path: "account", problem: "unknown-field" }]);
  assert.equal(JSON.stringify(result).includes("SECRET-XYZ"), false);
  const invalid = await client.callTool({ name: "scoat_hunt", arguments: { op: "invented" } });
  assert.equal(invalid.structuredContent.error.repair.issues[0].problem, "unknown-operation");
  assert.deepEqual(invalid.structuredContent.error.repair.operations, toolCatalog.scoat_hunt.input.options.map(option => option.shape.op.value));
  for (const [name, args] of [["scoat_guide", { job: "best-benefit", shop: null }], ["scoat_hunt", { op: "list" }], ["scoat_card", { op: "open", hunt: "h" }]]) parity(await client.callTool({ name, arguments: args }));
 });
});
test("repairs are executable reads derived only from validated calls", () => {
 for (const [code, kind] of [["conflict", "read-hunt"], ["incomplete", "read-hunt"], ["unproven", "read-hunt"], ["forbidden", "read-hunt"], ["missing", "list-hunts"], ["key-reused", "repeat-original-or-new-key"]]) {
  const call = parseToolCall("scoat_hunt", { op: "read", hunt: "h" });
  const failure = { code, message: "refused", next: "read" };
  const repair = repairFor(call, failure);
  assert.equal(repair.kind, kind);
  if ("call" in repair) parseToolCall(repair.call.tool, repair.call.arguments);
  assert.deepEqual(repair, repairFor(call, JSON.parse(JSON.stringify(failure))));
 }
});
test("gate fails closed on wrong outputs, missing data and error mismatches", () => {
 assert.throws(() => conform("scoat_hunt", { content: [] }), ContractBreach);
 assert.throws(() => conform("scoat_hunt", { content: [], structuredContent: { ok: true, value: {} } }), ContractBreach);
 assert.throws(() => conform("scoat_hunt", { ...refusal("missing", "Missing", "List hunts", { kind: "none" }), isError: false }), ContractBreach);
 parity(conform("scoat_hunt", refusal("missing", "Missing", "List hunts", { kind: "none" })));
});
test("pinned SDK rejects error structuredContent against a success-only schema", async () => {
 const advertised = structuredClone(descriptors());
 const output = advertised.find(tool => tool.name === "scoat_hunt").outputSchema;
 output.oneOf = output.oneOf.filter(branch => branch.properties.ok.const === true);
 await withClient(async client => {
  await assert.rejects(client.callTool({ name: "scoat_hunt", arguments: { op: "list" } }), /does not match.*output schema/);
 }, undefined, advertised);
});
test("native output and discovery enforcement rejects broken contracts", () => {
 const adapter = fs.readFileSync("src/mcp/index.ts", "utf8"), gate = fs.readFileSync("src/mcp/results.ts", "utf8");
 const entries = Object.fromEntries(descriptors().map(entry => [entry.name, entry]));
 checkOutputContract(entries, adapter, gate);
 for (const mutate of [entry => delete entry.outputSchema.type, entry => entry.outputSchema.oneOf.pop(), entry => delete entry.outputSchema, entry => entry.outputSchema.oneOf[0].properties.tuple = { type: "array", items: [{ type: "string" }], additionalItems: { type: "string" } }, ...["prefixItems", "dependencies", "dependentRequired", "dependentSchemas", "$recursiveRef", "$recursiveAnchor", "$dynamicRef", "$dynamicAnchor", "unevaluatedItems", "unevaluatedProperties", "minContains", "maxContains"].map(key => entry => entry.outputSchema[key] = {})]) {
  const changed = structuredClone(entries); mutate(changed.scoat_hunt);
  assert.throws(() => checkOutputContract(changed, adapter, gate));
 }
 assert.throws(() => checkOutputContract(entries, adapter.replace("return conform(name, await invoke(call))", "return await invoke(call)"), gate));
 assert.throws(() => checkOutputContract(entries, adapter, gate.replace("output.safeParse(wire)", "true")));
 for (const mutate of [entry => delete entry.title, entry => entry.annotations.readOnlyHint = true, entry => entry.annotations.destructiveHint = false, entry => entry.annotations.openWorldHint = true, entry => entry.annotations.idempotentHint = true, entry => entry.description = "No operations"]) {
  const changed = structuredClone(entries); mutate(changed.scoat_hunt);
  assert.throws(() => checkToolDescriptors(changed, toolCatalog, adapter));
 }
 assert.throws(() => checkToolDescriptors(entries, toolCatalog, adapter.replaceAll('io: "input"', 'io: "output"')));
});

test("Memory refusal enforcement rejects untyped errors and swallowed outages", () => {
 const source = fs.readFileSync("src/memory/index.ts", "utf8"), adapter = fs.readFileSync("src/mcp/authenticated.ts", "utf8");
 checkMemoryContract(source, adapter);
 assert.throws(() => checkMemoryContract(source.replace('throw new Error("Saved item integrity failure")', 'throw new MemoryRefusal("missing-item")'), adapter));
 for (const code of ["invalid-cursor", "missing-item", "key-reused", "session-mismatch", "expired"]) assert.throws(() => checkMemoryContract(source.replaceAll('new MemoryRefusal("' + code + '")', 'new Error("refused")'), adapter));
 for (const text of ["if (!(error instanceof MemoryRefusal)) throw error", "structuredContent: { ok: true, value }", 'value.kind === "confirmation-required"', 'value.kind === "unwatched"']) assert.throws(() => checkMemoryContract(source, adapter.replace(text, "false")));
});

test("card contract enforcement rejects public grants, private errors and swallowed failures", () => {
 const adapter=fs.readFileSync("src/mcp/authenticated.ts","utf8"), card=fs.readFileSync("src/card/adapter.ts","utf8"), contract=fs.readFileSync("src/card/contracts.ts","utf8");
 checkCardOutputContract(adapter,card,contract);
 for(const [before,after] of [["if (!(error instanceof ReadGrantFailure)) throw error",""],['value: { capability: "issued",','value: { capability: "issued", grant: capability.grant,'],['_meta: { "scoat/readCapability": capability }','_meta: {}']]) assert.throws(()=>checkCardOutputContract(adapter.replace(before,after),card,contract));
 assert.throws(()=>checkCardOutputContract(adapter,card.replace("cardOutput.safeParse(reply.structuredContent)",'cardOutput.safeParse(reply._meta["scoat/cardFailure"])'),contract));
 assert.throws(()=>checkCardOutputContract(adapter,card,contract.replaceAll("../mcp/outputs.js","./local.js")));
 assert.throws(()=>checkCardOutputContract(adapter+"JSON.stringify({})",card,contract));
});

test("input refusals distinguish missing and wrong type without exposing supplied secrets", () => {
 for (const [input, problem] of [[{op:"read"}, "missing"], [{op:"read",hunt:123}, "wrong-type"], [{op:"read",hunt:{secret:"SECRET-WRONG-TYPE"}}, "wrong-type"]]) {
  let result;
  try { parseToolCall("scoat_hunt", input); assert.fail("Expected invalid input"); }
  catch (error) { assert.ok(error instanceof z.ZodError); result = refuseInput("scoat_hunt", error); }
  assert.deepEqual(result.structuredContent.error.repair.issues, [{path:"hunt",problem}]);
  assert.equal(JSON.stringify(result).includes("SECRET-WRONG-TYPE"), false);
 }
});

test("card enforcement rejects missing invocation infrastructure translation", () => {
 const adapter=fs.readFileSync("src/mcp/authenticated.ts","utf8"), card=fs.readFileSync("src/card/adapter.ts","utf8"), contract=fs.readFileSync("src/card/contracts.ts","utf8"), server=fs.readFileSync("src/server.ts","utf8");
 for (const text of ["invocationUnavailable = databaseUnavailable(error)", "if (invocationUnavailable !== null)", 'return Response.json({ error: "service_unavailable" }, { status: 503 })']) assert.throws(() => checkCardOutputContract(adapter, card, contract, server.replace(text, "false")));
});
