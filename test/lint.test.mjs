import test from "node:test";
import assert from "node:assert/strict";
import { checkComments } from "../scripts/check-no-comments.mjs";
import { checkSdkImports, checkWire, checkWorkflow, checkTools, checkDependencyPair, checkPersonBoundary, checkHostConfig, checkRegistryAdapter, checkTypeConfig, checkDriver } from "../scripts/check-structure.mjs";

test("comment parser rejects comments outside src and accepts URL/regex literals", () => {
  for (const file of ["scripts/past.mjs", "test/past.ts", "vite.config.ts"]) assert.throws(() => checkComments(file, "const x = 1; /" + "/ forbidden"), /comments forbidden/);
  assert.throws(() => checkComments("ci.yaml", "jobs: {}\n# forbidden"), /comments forbidden/);
  assert.throws(() => checkComments("ci.yaml", "jobs:\n  # forbidden\n  a: {}"), /comments forbidden/);
  assert.doesNotThrow(() => checkComments("x.mjs", 'const url="https://example.com"; const re=/a\\/b/;'));
});
test("structural rules reject each offending fixture with supported fix", () => {
  assert.throws(() => checkSdkImports("src/domain.ts", 'import { Client } from "@modelcontextprotocol/sdk/client/index.js";'), /SDK-free/);
  assert.throws(() => checkSdkImports("src/server.ts", 'import { fixture } from "../fixtures/confirmation.mjs";'), /out of production/);
  assert.throws(() => checkWire({ $schema: "https://json-schema.org/draft/2020-12/schema" }), /draft-7/);
  assert.throws(() => checkWire({ type: "object", properties: {} }), /z.strictObject/);
  assert.throws(() => checkWorkflow("jobs:\n  bad:\n    runs-on: self-hosted"), /ubuntu-latest/);
  assert.throws(() => checkHostConfig('const config = {allowedHosts: ["localhost:*"]};'), /localPort/);
  assert.throws(() => checkRegistryAdapter('registerAppTool(server, "scoat_hunt", {inputSchema: huntInput});'), /root unions/);
  assert.throws(() => checkTypeConfig({compilerOptions:{}}), /node to tsconfig/);
  assert.throws(() => checkTools(["scoat_guide", "extra"]), /four Scoat/);
  assert.throws(() => checkDependencyPair({ dependencies: { "@modelcontextprotocol/ext-apps": "2.0.4", "@modelcontextprotocol/sdk": "1.32.2" } }), /1.7.5/);
  assert.throws(() => checkPersonBoundary('export async function person(args) { return {kind:"person", grant:args.grant}; }'), /always throw/);
  assert.throws(() => checkDriver('fork("server", [], {});'), /execArgv/);
  assert.throws(() => checkDriver('export async function connect() { await client.connect(transport); }'), /Close the Client/);
});
