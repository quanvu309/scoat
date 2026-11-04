import fs from "node:fs";
import { parse } from "@babel/parser";
import { parse as yaml } from "yaml";
import { schemas, toolCatalog } from "../dist/mcp/index.js";

export function checkSdkImports(file, source) {
  if (!file.startsWith("src/") || file.startsWith("src/mcp/") || file === "src/server.ts" || file === "src/card/index.ts") return;
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  for (const item of ast.program.body) {
    if (item.type === "ImportDeclaration" && /@modelcontextprotocol|\/arch\//.test(item.source.value)) throw new Error(`${file}: keep SDK/reference imports in MCP adapters; domain must remain SDK-free`);
  }
}
export function checkWire(schema) {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object" && schema.additionalProperties !== false) throw new Error("Use z.strictObject for every wire object; client principals/totals must fail before dispatch");
  for (const value of Object.values(schema)) if (Array.isArray(value)) value.forEach(checkWire); else if (value && typeof value === "object") checkWire(value);
}
export function checkWorkflow(source) {
  const workflow = yaml(source);
  for (const job of Object.values(workflow.jobs)) if (job["runs-on"] !== "ubuntu-latest") throw new Error("Use GitHub-hosted standard ubuntu-latest only");
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(file); else if (file.endsWith(".ts")) checkSdkImports(file, fs.readFileSync(file, "utf8"));
  }
}
export function checkTools(names) {
  if (JSON.stringify([...names].sort()) !== JSON.stringify(["scoat_card", "scoat_guide", "scoat_hunt", "scoat_memory"])) throw new Error("Use exactly the four Scoat product tools from the registry");
}
if (process.argv[1]?.endsWith("check-structure.mjs")) {
  walk("src");
  Object.values(schemas()).forEach(checkWire);
  checkTools(Object.keys(toolCatalog));
  checkWorkflow(fs.readFileSync(".github/workflows/ci.yaml", "utf8"));
}
