import fs from "node:fs";
import { parse } from "@babel/parser";
import { parse as yaml } from "yaml";
import { schemas, toolCatalog, promptInput } from "../dist/mcp/index.js";
import { publicSourceUrl } from "../dist/knowledge/index.js";
import { z } from "zod";

export function checkSdkImports(file, source) {
  if (!file.startsWith("src/")) return;
  const adapter = file.startsWith("src/mcp/") || file === "src/server.ts" || file === "src/card/index.ts";
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  for (const item of ast.program.body) {
    if (item.type === "ImportDeclaration") {
      if (/\/(arch|fixtures)\//.test(item.source.value)) throw new Error(`${file}: keep design and fixture imports out of production source`);
      if (!adapter && /@modelcontextprotocol/.test(item.source.value)) throw new Error(`${file}: keep SDK imports in MCP adapters; domain must remain SDK-free`);
    }
  }
}
export function checkWire(schema) {
  if (!schema || typeof schema !== "object") return;
  if (schema.$schema && schema.$schema !== "http://json-schema.org/draft-07/schema#") throw new Error("Use draft-7 JSON Schema to match the pinned MCP SDK tools/list");
  if (schema.type === "object" && !schema.oneOf && schema.additionalProperties !== false) throw new Error("Use z.strictObject for every wire object; client principals/totals must fail before dispatch");
  for (const value of Object.values(schema)) if (Array.isArray(value)) value.forEach(checkWire); else if (value && typeof value === "object") checkWire(value);
}
export function checkWorkflow(source) {
  const workflow = yaml(source);
  for (const job of Object.values(workflow.jobs)) if (job["runs-on"] !== "ubuntu-latest") throw new Error("Use GitHub-hosted standard ubuntu-latest only");
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(file); else if (/\.[cm]?[jt]s$/.test(file)) {
      const source = fs.readFileSync(file, "utf8");
      checkSdkImports(file, source);
      checkScratchAllocation(file, source);
    }
  }
}
export function checkTools(names) {
  if (JSON.stringify([...names].sort()) !== JSON.stringify(["scoat_card", "scoat_guide", "scoat_hunt", "scoat_memory"])) throw new Error("Use exactly the four Scoat product tools from the registry");
}
export function checkDependencyPair(pkg) {
  if (pkg.dependencies["@modelcontextprotocol/ext-apps"] !== "1.7.5" || pkg.dependencies["@modelcontextprotocol/sdk"] !== "1.32.2") throw new Error("P01 spike supports ext-apps 1.7.5 with SDK 1.32.2; rerun compatibility spike before changing pins");
}
export function checkPersonBoundary(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  const fn = ast.program.body.find(item => item.type === "ExportNamedDeclaration" && item.declaration?.type === "FunctionDeclaration" && item.declaration.id?.name === "person")?.declaration;
  if (!fn || fn.body.body.length !== 1 || fn.body.body[0].type !== "ThrowStatement") throw new Error("P01 person must always throw; add real same-account authentication before enabling controls");
}
export function checkHostConfig(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  const found = new Set();
  function exactSocketTemplate(element, prefix) {
    if (element?.type !== "TemplateLiteral" || element.quasis.length !== 2 || element.expressions.length !== 1) return false;
    const expression = element.expressions[0];
    return element.quasis[0].value.cooked === prefix && element.quasis[1].value.cooked === ""
      && expression.type === "MemberExpression" && expression.property?.name === "localPort"
      && expression.object?.type === "MemberExpression" && expression.object.object?.name === "req"
      && expression.object.property?.name === "socket";
  }
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "ObjectProperty" && ["allowedHosts", "allowedOrigins"].includes(node.key?.name)) {
      const name = node.key.name;
      const prefixes = name === "allowedHosts" ? ["localhost:", "127.0.0.1:"] : ["http://localhost:", "http://127.0.0.1:"];
      found.add(name);
      const elements = node.value.type === "ArrayExpression" ? node.value.elements : [];
      if (elements.length !== 2 || elements.some((element, index) => !exactSocketTemplate(element, prefixes[index]))) throw new Error(`Use exact loopback socket localPort in ${name}`);
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(ast.program);
  for (const name of ["allowedHosts", "allowedOrigins"]) if (!found.has(name)) throw new Error(`Use exact loopback socket localPort in ${name}`);
}
export function checkRegistryAdapter(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "CallExpression" && (node.callee?.name === "registerAppTool" || node.callee?.property?.name === "registerTool")) throw new Error("Use registry-derived ListToolsRequestSchema handler; SDK 1.x normalizes root unions to empty objects");
    if (node.type === "CallExpression" && node.callee?.property?.name === "registerPrompt") throw new Error("Use strict raw GetPromptRequestSchema parsing; SDK registerPrompt strips unknown argument keys");
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(ast.program);
}

export function checkReleaseSources(release) {
  for (const fact of release.facts) publicSourceUrl.parse(fact.source);
}

export function checkTypeConfig(config) {
  if (!config.compilerOptions.types?.includes("node")) throw new Error("Add node to tsconfig types for TypeScript 7 server typecheck");
}

export function checkDriver(source) {
  const ast = parse(source, { sourceType: "module" });
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "CallExpression" && node.callee?.name === "fork") {
      const option = node.arguments[2]?.properties?.find(property => property.key?.name === "execArgv");
      if (option?.value.type !== "ArrayExpression" || option.value.elements.length !== 0) throw new Error("Set fork execArgv to an empty array; do not inherit test or input-type flags");
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(ast.program);
  const connect = ast.program.body.find(item => item.declaration?.id?.name === "connect")?.declaration;
  const handler = connect?.body.body.find(item => item.type === "TryStatement")?.handler;
  const closes = handler?.body.body.some(item => item.type === "ExpressionStatement" && item.expression.type === "AwaitExpression" && item.expression.argument.callee?.object?.name === "client" && item.expression.argument.callee?.property?.name === "close");
  if (!closes || !handler.body.body.some(item => item.type === "ThrowStatement")) throw new Error("Close the Client in connect's catch before rethrowing failed initialization");
}

if (process.argv[1]?.endsWith("check-structure.mjs")) {
  walk("src");
  walk("scripts");
  walk("test");
  checkHuntAuthority(fs.readFileSync("src/domain.ts", "utf8"));
  checkCandidateSearch(fs.readFileSync("src/hunt/pricing.ts", "utf8"));
  checkViewCoverage(fs.readFileSync("src/hunt/view.ts", "utf8"));
  checkCodeAuthority(fs.readFileSync("src/hunt/evidence.ts", "utf8"));
  checkScenarioProjection(fs.readFileSync("src/domain.ts", "utf8"), fs.readFileSync("src/hunt/index.ts", "utf8"));
  checkKnowledgeTypes(fs.readFileSync("src/knowledge/index.ts", "utf8"));
  Object.values(schemas()).forEach(checkWire);
  checkWire(z.toJSONSchema(promptInput, { target: "draft-7" }));
  for (const file of fs.readdirSync("knowledge/releases")) if (file.endsWith(".json")) checkReleaseSources(JSON.parse(fs.readFileSync(`knowledge/releases/${file}`, "utf8")));
  checkTools(Object.keys(toolCatalog));
  checkWorkflow(fs.readFileSync(".github/workflows/ci.yaml", "utf8"));
  checkDependencyPair(JSON.parse(fs.readFileSync("package.json", "utf8")));
  const adapter = fs.readFileSync("src/mcp/index.ts", "utf8");
  checkPersonBoundary(adapter);
  checkRegistryAdapter(adapter);
  checkHostConfig(fs.readFileSync("src/server.ts", "utf8"));
  checkTypeConfig(JSON.parse(fs.readFileSync("tsconfig.json", "utf8")));
  checkDriver(fs.readFileSync("scripts/driver.mjs", "utf8"));
}

export function checkKnowledgeTypes(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (["TSParameterProperty", "TSEnumDeclaration", "TSModuleDeclaration"].includes(node.type)) throw new Error("Knowledge must use erasable TypeScript for Node strip-only tests; declare fields explicitly");
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(ast.program);
}

export function checkHuntAuthority(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "TSPropertySignature" && node.key?.name === "stackProof") throw new Error("Replace unbound stackProof with exact-set compatibility authority");
    if (node.type === "TSPropertySignature" && node.key?.name === "__brand") throw new Error("Derive identifier brands from validated schemas using z.$brand");
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(ast.program);
}

export function checkCandidateSearch(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "CallExpression" && node.callee?.property?.name === "sort" && JSON.stringify(node.arguments).includes('"name":"key"')) throw new Error("Precompute candidate rank keys before sorting");
    if (node.type === "BinaryExpression" && node.operator === "**" && node.right?.type === "MemberExpression" && node.right.object?.name === "benefits" && node.right.property?.name === "length") throw new Error("Enumerate authorized complete sets rather than generating unsupported benefit subsets");
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(ast.program);
}

export function checkViewCoverage(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  const finishable = ast.program.body.find(node => node.declaration?.id?.name === "finishable")?.declaration;
  if (finishable && !finishable.params.some(parameter => parameter.name === "release")) throw new Error("Finishability requires pinned release recipes to detect missing whole rows");
  if (finishable && !finishable.params.some(parameter => parameter.name === "originalSeller")) throw new Error("Finishability requires originalSeller to exclude the original shop from other-seller coverage");
  const coverage = ast.program.body.find(node => node.id?.name === "rowGaps");
  if (coverage && !astNodes(coverage).some(node => node.type === "CallExpression" && node.callee?.property?.name === "includes" && node.callee.object?.property?.name === "slots")) throw new Error("Validate recorded slot membership in pinned recipe slots before counting coverage");
}

function astNodes(root) {
  const result = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type) result.push(node);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(root);
  return result;
}
export function checkCodeAuthority(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  const evidence = ast.program.body.find(node => node.declaration?.id?.name === "parseEvidence")?.declaration;
  if (evidence && !astNodes(evidence).some(node => node.type === "CallExpression" && node.callee?.name === "isOfficialSource")) throw new Error("Validate retailer-tested code against isOfficialSource and the pinned release; origin labels are not authority");
}
export function checkScratchAllocation(file, source) {
  if (file === "scripts/scratch.mjs") return;
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if ((node.type === "ImportSpecifier" && node.imported?.name === "mkdtemp") || (node.type === "CallExpression" && (node.callee?.name === "mkdtemp" || node.callee?.property?.name === "mkdtemp"))) throw new Error(`${file}: use scratchDirectory so an absent ~/tmp parent is created before allocation`);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(ast.program);
}
export function checkScenarioProjection(domain, hunt) {
  const domainNodes = astNodes(parse(domain, { sourceType: "module", plugins: ["typescript"] }));
  for (const conditional of domainNodes.filter(node => node.type === "TSPropertySignature" && node.key?.name === "conditional")) {
    const fields = new Set(astNodes(conditional.typeAnnotation).filter(node => node.type === "TSPropertySignature").map(node => node.key?.name));
    if (["selection", "backLater", "perks"].some(field => !fields.has(field))) throw new Error("Each conditional scenario must retain selection, backLater and perks from its authorized offer set");
  }
  const huntNodes = astNodes(parse(hunt, { sourceType: "module", plugins: ["typescript"] }));
  const view = huntNodes.find(node => node.type === "TSTypeAliasDeclaration" && node.id?.name === "HuntView");
  if (view && !astNodes(view).some(node => node.type === "TSPropertySignature" && node.key?.name === "quotes")) throw new Error("Retain all quotes in HuntView so structured and text renderers share every scenario");
}
