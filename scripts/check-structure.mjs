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
  for (const job of Object.values(workflow.jobs)) {
    if (job["runs-on"] !== "ubuntu-latest") throw new Error("Use GitHub-hosted standard ubuntu-latest only");
    if (job.steps?.some(step => /npm run (verify|perf) -- p05/.test(step.run ?? ""))) {
      const checkout = job.steps.find(step => step.uses?.startsWith("actions/checkout@"));
      if (checkout?.with?.["fetch-depth"] !== 0) throw new Error("Fetch full history with checkout fetch-depth: 0 so P05 evidence can inspect origin/main");
    }
  }
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
  if (!fn || fn.body.body.length !== 1 || fn.body.body[0].type !== "ThrowStatement") throw new Error("Person must always throw until separately verified same-account browser confirmation enables controls");
}
export function checkHostConfig(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  const found = new Set();
  const arrays = new Map(astNodes(ast).filter(node=>node.type==="VariableDeclarator" && ["allowedHosts","allowedOrigins"].includes(node.id?.name)).map(node=>[node.id.name,node.init]));
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
      const elements = (node.value.type === "Identifier" ? arrays.get(node.value.name) : node.value)?.elements ?? [];
      const extension = elements[2];
      const trusted = extension?.type === "SpreadElement" && extension.argument.type === "ConditionalExpression"
        && extension.argument.test.name === "auth" && extension.argument.alternate.type === "ArrayExpression" && extension.argument.alternate.elements.length === 0
        && extension.argument.consequent.type === "ArrayExpression" && extension.argument.consequent.elements.length === 1;
      const value = extension?.argument?.consequent?.elements?.[0];
      const issuer = value?.type === "MemberExpression" && value.object?.name === "auth" && value.property?.name === "issuer";
      const host = value?.type === "MemberExpression" && value.property?.name === "host" && value.object?.type === "NewExpression" && value.object.callee?.name === "URL"
        && value.object.arguments.length === 1 && value.object.arguments[0]?.object?.name === "auth" && value.object.arguments[0]?.property?.name === "issuer";
      if (![2,3].includes(elements.length) || elements.slice(0,2).some((element, index) => !exactSocketTemplate(element, prefixes[index])) || (elements.length === 3 && (!trusted || !(name === "allowedHosts" ? host : issuer)))) throw new Error(`Use exact loopback socket localPort and only the configured issuer in ${name}`);
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(ast.program);
  function references(node, parent) {
    if (!node || typeof node !== "object") return;
    if (node.type === "Identifier" && arrays.has(node.name)) {
      const declaration = parent?.type === "VariableDeclarator" && parent.id === node;
      const option = parent?.type === "ObjectProperty" && ["allowedHosts", "allowedOrigins"].includes(parent.key?.name);
      const lookup = parent?.type === "MemberExpression" && parent.object === node && parent.property?.name === "includes" && !parent.computed;
      if (!declaration && !option && !lookup) throw new Error("Keep allowedHosts and allowedOrigins immutable; extend only with the configured issuer");
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(child => references(child,node)); else if (value && typeof value === "object") references(value,node);
  }
  references(ast.program);
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
  checkRemoteBoundary(fs.readFileSync("src/server.ts", "utf8"));
  checkErasureCoordinator(fs.readFileSync("src/accounts/erasure.ts", "utf8"));
  checkExplicitEnrollment(fs.readFileSync("src/auth/identity.ts", "utf8"));
  checkBrowserFlowClock(fs.readFileSync("src/auth/issuer.ts", "utf8"),fs.readFileSync("src/auth/flows.ts", "utf8"));
  checkEraseRecovery(fs.readFileSync("src/auth/issuer.ts", "utf8"));
  checkLinkSuppression(fs.readFileSync("src/auth/issuer.ts", "utf8"),fs.readFileSync("src/auth/link.ts", "utf8"));
  checkMemoryVerification(fs.readFileSync(".agents/skills/verify-scoat/SKILL.md", "utf8"),fs.readFileSync(".agents/skills/verify-scoat/features/README.md", "utf8"));
  checkPublicAuthority(fs.readFileSync("src/index.ts", "utf8"));
  checkGrantRenewal(fs.readFileSync("src/auth/grants.ts", "utf8"));
  checkConsentDecision(fs.readFileSync("src/auth/issuer.ts", "utf8"));
  checkAuthorizationPolicy(fs.readFileSync("src/auth/issuer.ts", "utf8"));
  checkBrowserLink(fs.readFileSync("src/auth/issuer.ts", "utf8"));
  checkLinkRetirement(fs.readFileSync("src/auth/link.ts", "utf8"));
  checkAuthVerification(fs.readFileSync(".agents/skills/verify-scoat/SKILL.md", "utf8"), fs.readFileSync(".agents/skills/verify-scoat/features/README.md", "utf8"));
  checkDurableFences(fs.readFileSync("src/hunt/postgres.ts", "utf8"));
  checkStartReplay(fs.readFileSync("src/hunt/index.ts", "utf8"));
  checkDurableCommands(fs.readFileSync("src/hunt/index.ts", "utf8"));
  checkRaceBarriers(fs.readFileSync("scripts/verify-durable.mjs", "utf8"));
  checkTransactionGuidance(fs.readFileSync("RATIONALE.md", "utf8"));
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

export function checkDurableFences(source) {
  if (/lockAll|ISOLATION LEVEL SERIALIZABLE/.test(source)) throw new Error("Use named READ COMMITTED account/hunt fences and addressed rows");
  if (!source.includes("BEGIN ISOLATION LEVEL READ COMMITTED") || !source.includes("Inactive account incarnation")) throw new Error("Fence every transaction on the persisted account incarnation");
}

export function checkStartReplay(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  const method = astNodes(ast).find(node => node.type === "ClassMethod" && node.key?.name === "run");
  const calls = astNodes(method).filter(node => node.type === "CallExpression");
  const replay = calls.find(node => node.callee?.property?.name === "priorReceipt");
  const knowledge = calls.find(node => node.callee?.property?.name === "read" && node.callee.object?.property?.name === "knowledge");
  if (!replay || !knowledge || replay.start > knowledge.start) throw new Error("Probe the fenced receipt before start knowledge loading so old replays survive provider failure");
}

export function checkDurableCommands(source) {
  const nodes = astNodes(parse(source, { sourceType: "module", plugins: ["typescript"] }));
  if (nodes.some(node => node.type === "CallExpression" && node.callee?.name === "finishable")) throw new Error("Use canonical HuntView.progress for the finish decision so inferred seller coverage agrees with the rendered view");
}

export function checkRaceBarriers(source) {
  const nodes = astNodes(parse(source, { sourceType: "module" }));
  for (const assignment of nodes.filter(node => node.type === "AssignmentExpression" && node.left?.object?.name === "hooks" && ["afterAccountFence", "beforeAccountFence"].includes(node.left?.property?.name))) {
    const body = astNodes(assignment.right);
    for (const signal of body.filter(node => node.type === "CallExpression" && node.callee?.property?.name === "resolve" && ["entered", "eraseEntered"].includes(node.callee.object?.name))) {
      if (!body.some(node => node.type === "AwaitExpression" && node.argument?.callee?.name === "proveContention" && node.start < signal.start)) throw new Error("Await proveContention before signaling a contended race; a hook before lock acquisition cannot prove PostgreSQL contention");
    }
  }
}

export function checkTransactionGuidance(source) {
  if (/Finish and stop take every row lock/i.test(source)) throw new Error("Document finish and stop with an exclusive hunt fence inside the shared account fence");
}

function member(node, object, property) {
  return node?.type === "MemberExpression" && node.object?.name === object && node.property?.name === property && !node.computed;
}
function parsedNodes(source) { return astNodes(parse(source,{sourceType:"module",plugins:["typescript"]})); }
export function checkRemoteBoundary(source) {
  const nodes = parsedNodes(source);
  const handler = nodes.find(node => node.type === "VariableDeclarator" && node.id?.name === "handler")?.init;
  const body = handler?.body?.body ?? [];
  const authentication = body.find(node => node.type === "TryStatement" && node.block.body.some(statement => statement.type === "ExpressionStatement" && statement.expression.type === "AssignmentExpression" && statement.expression.left?.name === "principal" && statement.expression.right?.type === "AwaitExpression" && member(statement.expression.right.argument?.callee,"auth","authenticate")));
  const dispatch = body.flatMap(node => node.declarations ?? []).find(node => node.id?.name === "invoke" && node.init?.callee?.name === "authenticatedDispatch" && node.init.arguments[0]?.name === "store" && node.init.arguments[1]?.name === "principal");
  const server = body.flatMap(node => node.declarations ?? []).find(node => node.init?.callee?.name === "createMcpServer");
  const callback = server?.init?.arguments?.[0];
  const returns = astNodes(callback).filter(node => node.type === "ReturnStatement");
  const result = returns[0]?.argument;
  const invokes = returns.length === 1 && result?.type === "AwaitExpression" && result.argument?.type === "CallExpression" && result.argument.callee?.name === "invoke" && result.argument.arguments[0]?.name === callback.params?.[0]?.name;
  const assignments = nodes.filter(node => node.type === "AssignmentExpression" && astNodes(node.left).some(part => part.type === "Identifier" && part.name === "principal"));
  const authenticatedAssignment = authentication?.block.body.find(statement => statement.expression?.left?.name === "principal")?.expression;
  const stablePrincipal = assignments.length === 1 && assignments[0] === authenticatedAssignment && !nodes.some(node => node.type === "UpdateExpression" && node.argument?.name === "principal");
  if (!authentication || !dispatch || !server || authentication.start > dispatch.start || dispatch.start > server.start || !invokes || !stablePrincipal || authentication.handler?.body.body.at(-1)?.type !== "ReturnStatement") throw new Error("Await the verified issuer principal and pass it to the production MCP dispatcher; return on authentication failure");
  const closed = body.find(node => node.type === "IfStatement" && node.test.type === "LogicalExpression" && node.test.operator === "||" && node.test.left.operator === "!" && node.test.left.argument?.name === "auth" && node.test.right.operator === "!" && node.test.right.argument?.name === "store");
  if (!closed || closed.start > authentication.start || closed.consequent.body?.at(-1)?.type !== "ReturnStatement" || !astNodes(closed.consequent).some(node => node.type === "CallExpression" && member(node.callee,"res","writeHead") && node.arguments[0]?.value === 503)) throw new Error("Fail closed without issuer configuration before authentication or MCP construction");
  const unavailable = authentication.handler.body.body.find(node => node.type === "IfStatement" && node.test.type === "UnaryExpression" && node.test.operator === "!" && node.test.argument?.type === "BinaryExpression" && node.test.argument.operator === "instanceof" && node.test.argument.right?.name === "InvalidCredential");
  if (!unavailable || unavailable.consequent.body?.at(-1)?.type !== "ReturnStatement" || !astNodes(unavailable.consequent).some(node => node.type === "CallExpression" && member(node.callee,"res","writeHead") && node.arguments[0]?.value === 503)) throw new Error("Return 503 for authentication infrastructure failures; reserve 401 for InvalidCredential");
}
export function checkPublicAuthority(source) {
  const nodes = parsedNodes(source);
  const authorityImports = new Set(nodes.filter(node => node.type === "ImportDeclaration" && node.importKind !== "type" && /\/auth(?:\/|$)/.test(node.source.value)).flatMap(node => node.specifiers.filter(specifier => specifier.importKind !== "type").map(specifier => specifier.local.name)));
  for (const node of nodes) {
    if (node.exportKind === "type") continue;
    if (((node.type === "ExportDefaultDeclaration" || node.type === "ExportNamedDeclaration") && astNodes(node.declaration).some(part => part.type === "Identifier" && authorityImports.has(part.name))) || node.type === "ExportAllDeclaration" || (node.type === "ExportNamedDeclaration" && /\/auth(?:\/|$)/.test(node.source?.value ?? "")) || (node.type === "ExportSpecifier" && node.exportKind !== "type" && (authorityImports.has(node.local?.name) || ["authenticate","person","principalFor","resolveIdentity","mount"].includes(node.local?.name)))) throw new Error("Keep runtime principal constructors and authority adapters out of the public barrel; use named value exports");
  }
}
export function checkGrantRenewal(source) {
  const nodes = parsedNodes(source);
  for (const node of nodes) if (node.type === "ClassMethod" && node.key.name === "use" && astNodes(node).some(call => call.type === "CallExpression" && call.callee?.object?.type === "ThisExpression" && call.callee.property?.name === "open")) throw new Error("Renew the bound grant atomically; do not revoke then call open in a second transaction");
  const query = nodes.find(node => node.type === "ClassMethod" && node.key?.name === "query" && node.accessibility === "private");
  const calls = astNodes(query).filter(node => node.type === "CallExpression" && member(node.callee,"client","query"));
  const fence = calls.find(node => node.arguments[0]?.type === "StringLiteral" && /SELECT 1 FROM hunt_accounts.*NOT erased FOR SHARE/.test(node.arguments[0].value));
  const guarded = astNodes(query).find(node => node.type === "IfStatement" && node.test.operator === "!" && member(node.test.argument,"active","rowCount") && node.consequent.type === "ThrowStatement");
  const reads = calls.find(node => node.arguments[0]?.name === "sql");
  const poolReferences = nodes.filter(node => node.type === "MemberExpression" && node.object?.type === "ThisExpression" && (node.property?.name === "pool" || node.property?.value === "pool"));
  const permittedThis = new Set(nodes.filter(node => node.type === "MemberExpression" && node.object?.type === "ThisExpression" && !node.computed && node.property?.name === "query").map(node => node.object));
  if (poolReferences.length === 1) permittedThis.add(poolReferences[0].object);
  const exposedThis = nodes.some(node => node.type === "ThisExpression" && !permittedThis.has(node));
  const validPool = !exposedThis && poolReferences.length === 1 && poolReferences[0].start >= (query?.start ?? Infinity) && poolReferences[0].end <= query.end && astNodes(query).some(node => node.type === "CallExpression" && node.callee?.property?.name === "connect" && node.callee.object === poolReferences[0]);
  if (!validPool || !fence || !guarded || !reads || !(fence.start < guarded.start && guarded.start < reads.start)) throw new Error("Fence capability operations with the active account before accessing grants; keep pool access in private query");
}
export function checkConsentDecision(source) {
  const nodes = parsedNodes(source);
  const declarations = nodes.filter(node => node.type === "VariableDeclarator" && node.id?.type === "Identifier");
  const enumSchema = node => node?.type === "CallExpression" && member(node.callee,"z","enum") && JSON.stringify(node.arguments[0]?.elements?.map(item => item.value)) === '["allow","deny"]';
  const parseDecision = node => {
    if (node?.type !== "CallExpression" || node.callee?.property?.name !== "safeParse" || !member(node.arguments[0]?.callee,"submitted","get") || node.arguments[0]?.arguments[0]?.value !== "decision") return false;
    const schema = node.callee.object;
    return enumSchema(schema) || (schema?.type === "Identifier" && declarations.some(binding => binding.id.name === schema.name && binding.start < node.start && enumSchema(binding.init)));
  };
  const rejectsDecision = node => {
    if (node?.type === "LogicalExpression" && node.operator === "||") return rejectsDecision(node.left) || rejectsDecision(node.right);
    if (node?.type !== "UnaryExpression" || node.operator !== "!") return false;
    const value = node.argument;
    if (value.type === "CallExpression" && value.callee?.property?.name === "includes" && JSON.stringify(value.callee.object?.elements?.map(item => item.value)) === '["allow","deny"]') {
      const input = value.arguments[0]?.type === "LogicalExpression" && value.arguments[0].operator === "??" ? value.arguments[0].left : value.arguments[0];
      return member(input?.callee,"submitted","get") && input.arguments[0]?.value === "decision";
    }
    if (value.type !== "MemberExpression" || value.computed || value.property?.name !== "success") return false;
    return parseDecision(value.object) || (value.object.type === "Identifier" && declarations.some(binding => binding.id.name === value.object.name && binding.start < node.start && parseDecision(binding.init)));
  };
  const consent = nodes.find(node => node.type === "CallExpression" && member(node.callee,"provider","interactionFinished") && astNodes(node.arguments[2]).some(part => part.type === "ObjectProperty" && part.key?.name === "consent"));
  const rejecting = nodes.filter(node => node.type === "BlockStatement" && node.body.some(statement => astNodes(statement).includes(consent) && statement.type === "ExpressionStatement")).flatMap(node => node.body).find(node => node.type === "IfStatement" && rejectsDecision(node.test) && node.consequent.body?.at(-1)?.type === "ReturnStatement" && node.start < (consent?.start ?? 0));
  if (!rejecting || !consent) throw new Error("Require an explicit allow or deny decision with a terminating rejection before completing consent");
}
export function checkAuthorizationPolicy(source) {
  const nodes = parsedNodes(source);
  const provider = nodes.find(node => node.type === "NewExpression" && node.callee?.name === "Provider");
  const options = provider?.arguments?.[1]?.properties;
  const policy = options?.find(node => node.key?.name === "extraParams")?.value.properties?.find(node => node.key?.name === "state")?.value;
  const guard = astNodes(policy).find(node => node.type === "IfStatement" && node.consequent.type === "ThrowStatement");
  const checks = astNodes(guard?.test);
  const resourcePolicy = options?.find(node => node.key?.name === "features")?.value.properties?.find(node => node.key?.name === "resourceIndicators")?.value.properties?.find(node => node.key?.name === "defaultResource")?.value;
  if (policy && !astNodes(resourcePolicy).some(node => node.type === "ThrowStatement" && node.argument?.callee?.property?.name === "InvalidTarget")) throw new Error("Reject a missing explicit resource; do not synthesize the resource before policy validation");
  if (!guard || !checks.some(node => node.type === "UnaryExpression" && node.operator === "!" && node.argument?.name === "value") || !checks.some(node => node.type === "OptionalMemberExpression" && node.property?.name === "resource") || !checks.some(node => node.type === "OptionalMemberExpression" && node.property?.name === "code_challenge_method")) throw new Error("Enforce state, resource and S256 in the provider parsed-parameter validation hook for every route alias");
  const responseTypes = options.find(node => node.key?.name === "responseTypes")?.value;
  const scopes = options.find(node => node.key?.name === "scopes")?.value;
  const features = options.find(node => node.key?.name === "features")?.value.properties ?? [];
  const disabled = ["dPoP", "pushedAuthorizationRequests", "userinfo", "rpInitiatedLogout"].every(name => features.find(node => node.key?.name === name)?.value.properties?.some(node => node.key?.name === "enabled" && node.value?.value === false));
  if (JSON.stringify(responseTypes?.elements?.map(node => node.value)) !== '["code"]' || JSON.stringify(scopes?.elements?.map(node => node.value)) !== '["openid"]' || !disabled) throw new Error("Advertise only the shipped authorization-code flow and disable unused issuer endpoints");
}
export function checkBrowserLink(source) {
  const nodes = parsedNodes(source);
  const link = nodes.find(node => node.type === "IfStatement" && node.test.type === "BinaryExpression" && node.test.right?.value === "/account/link");
  const body = link?.consequent.body ?? [];
  const entry = body.find(node => node.type === "IfStatement" && node.test.right?.value === "GET" && astNodes(node.consequent).some(call => call.type === "CallExpression" && call.callee?.name === "upstreamRedirect" && call.arguments[1]?.properties?.some(property => property.value?.value === "link-current")));
  const consumed = astNodes(link).find(node => node.type === "CallExpression" && member(node.callee,"pool","query") && node.arguments[0]?.value === "DELETE FROM oauth_browser_flows WHERE state=$1 AND expires_at>now() RETURNING data");
  const bound = body.find(node => node.type === "IfStatement" && astNodes(node.test).some(test => test.type === "BinaryExpression" && test.operator === "!==" && test.right?.value === "link-confirm") && node.consequent.type === "ThrowStatement");
  const candidate = astNodes(link).find(node => node.type === "CallExpression" && node.callee?.name === "upstreamRedirect" && node.arguments[1]?.properties?.some(property => property.value?.value === "link-candidate"));
  const cookie = bound && astNodes(bound.test).some(node => node.type === "BinaryExpression" && node.operator === "!==" && node.left?.callee?.name === "digest" && node.left.arguments[0]?.name === "browser" && member(node.right,"flow","browser"));
  const origin = body.find(node => node.type === "IfStatement" && astNodes(node.test).some(test => test.type === "BinaryExpression" && member(test.left?.object,"req","headers") && test.left?.property?.name === "origin" && test.operator === "!==" && test.right?.name === "issuer") && node.consequent.body?.at(-1)?.type === "ReturnStatement");
  if (!entry || !consumed || !bound || !cookie || !origin || !candidate || !(consumed.start < bound.start && bound.start < candidate.start)) throw new Error("Start linking in a browser and consume a browser-bound confirmation before the candidate sign-in");
}
export function checkLinkRetirement(source) {
  const nodes = parsedNodes(source);
  const queries = nodes.filter(node => node.type === "CallExpression" && member(node.callee,"client","query"));
  const lock = queries.find(node => node.arguments[0]?.value?.includes("ORDER BY account,incarnation FOR UPDATE"));
  const retired = queries.find(node => node.arguments[0]?.value === "UPDATE hunt_accounts SET erased=true,erased_at=now() WHERE account=$1 AND incarnation=$2");
  const move = queries.find(node => node.arguments[0]?.value?.startsWith("INSERT INTO oauth_identities"));
  if (!lock || !retired || !move || !(lock.start < retired.start && retired.start < move.start)) throw new Error("Retire the old account under its exclusive fence before moving its last identity");
  const migration = nodes.find(node => node.type === "BlockStatement" && node.body.some(statement => astNodes(statement).includes(retired) && statement.type === "ExpressionStatement"));
  const refusal = (name, sql) => {
    const statements = migration?.body ?? [];
    const read = statements.find(node => node.type === "VariableDeclaration" && node.declarations.some(binding => binding.id?.name === name && binding.init?.type === "AwaitExpression" && member(binding.init.argument?.callee,"client","query") && binding.init.argument.arguments[0]?.value === sql));
    const reject = statements.find(node => node.type === "IfStatement" && member(node.test,name,"rowCount") && node.consequent.type === "ThrowStatement");
    return read && reject && lock && retired && lock.start < read.start && read.start < reject.start && reject.start < retired.start;
  };
  if (!refusal("hunts", "SELECT 1 FROM durable_hunts WHERE account=$1 AND incarnation=$2 LIMIT 1") || !refusal("others", "SELECT 1 FROM oauth_identities WHERE account=$1 AND incarnation=$2 AND (issuer<>$3 OR subject<>$4) LIMIT 1")) throw new Error("Refuse candidate accounts with hunts or other identities before retiring or moving them");
}
export function checkAuthVerification(skill, index) {
  const header = skill.split("---")[1] ?? "";
  const routing = skill.split("## Completion")[0];
  if (!/OAuth/.test(header) || /excludes[^.]*OAuth/i.test(header) || !routing.includes("features/auth.md") || !index.includes("[authentication](auth.md)")) throw new Error("Route OAuth changes from the verification skill header and feature index to features/auth.md");
}

function requireOrderedStatements(body,required,message) {
 const normalize = value => {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["start","end","loc","extra","typeParameters","typeArguments"].includes(key)).map(([key,item]) => [key,normalize(item)]));
 };
 const signature = node => JSON.stringify(normalize(node));
 const statements = parse("async function expected(){"+required+"}",{sourceType:"module"}).program.body[0].body.body;
 let position = -1;
 for (const expected of statements) {
  const next = body.findIndex((node,index) => index>position && signature(node)===signature(expected));
  if (next<0) throw new Error(message);
  position=next;
 }
}
export function checkErasureCoordinator(source) {
 const root = parse(source,{sourceType:"module",plugins:["typescript"]}).program;
 const body = root.body.find(node => node.type === "ExportNamedDeclaration" && node.declaration?.id?.name === "eraseAccount")?.declaration?.body?.body ?? [];
 const required = `
 const prefix = [scope.account,scope.incarnation];
 const candidates = await client.query("SELECT issuer,subject FROM oauth_identities WHERE account=$1 AND incarnation=$2 ORDER BY issuer,subject",prefix);
 const lockedSubjects = new Set(candidates.rows.map(identity => JSON.stringify([identity.issuer,identity.subject])));
 for (const subject of lockedSubjects) await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[subject]);
 const active = await client.query("SELECT 1 FROM hunt_accounts WHERE account=$1 AND incarnation=$2 AND NOT erased FOR UPDATE",prefix);
 if (!active.rowCount) throw new Error("Inactive account incarnation");
 const status = await client.query("SELECT 1 FROM erase_status WHERE digest=$1 AND completed_at IS NULL AND expires_at>now() FOR UPDATE",[statusDigest]);
 if (!status.rowCount) throw new Error("Completion capability unavailable");
 const identities = await client.query("SELECT issuer,subject FROM oauth_identities WHERE account=$1 AND incarnation=$2",prefix);
 if (identities.rows.some(identity => !lockedSubjects.has(JSON.stringify([identity.issuer,identity.subject])))) throw new SerializationConflict("Identity inventory changed");
 for (const identity of identities.rows) {
  const pseudonym = createHmac("sha256",lifecycleKey).update(JSON.stringify([identity.issuer,identity.subject])).digest("hex");
  await client.query("INSERT INTO account_suppression(account,incarnation,subject_digest,key_version,erased_at,purge_after) VALUES($1,$2,$3,$4,clock_timestamp(),clock_timestamp()+interval '31 days')",[...prefix,pseudonym,keyVersion]);
 }
 const authentication = await deleteAuthentication(client,scope,identities.rows);
 const memory = await deleteMemory(client,scope);
 const hunts = await deleteHunts(client,scope);
 await client.query("UPDATE hunt_accounts SET erased=true,erased_at=now() WHERE account=$1 AND incarnation=$2",prefix);
 `;
 requireOrderedStatements(body,required,"Accounts erasure must await every fixed owner deletion port after its exclusive active account fence, subject locks, inventory recheck and suppression tombstones");
}
export function checkLinkSuppression(issuer,link) {
 const root = parse(link,{sourceType:"module",plugins:["typescript"]}).program;
 const body = root.body.find(node => node.type === "ExportNamedDeclaration" && node.declaration?.id?.name === "linkIdentity")?.declaration?.body?.body.find(node => node.type === "TryStatement")?.block.body ?? [];
 const message = "Reject pre-erasure link flows under the subject lock using the original database-stamped start";
 requireOrderedStatements(body,`
 await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[JSON.stringify([issuer,subject])]);
 const pseudonym = createHmac("sha256",lifecycleKey).update(JSON.stringify([issuer,subject])).digest("hex");
 const suppressed = await client.query("SELECT 1 FROM account_suppression WHERE subject_digest=$1 AND erased_at>=to_timestamp($2/1000.0) AND purge_after>now() LIMIT 1",[pseudonym,startedAt]);
 if (suppressed.rowCount) throw new Error("Link flow predates erasure; start linking again");
 const existing = (await client.query("SELECT account,incarnation FROM oauth_identities WHERE issuer=$1 AND subject=$2",[issuer,subject])).rows[0];
 `,message);
 const nodes = parsedNodes(issuer);
 const callback = nodes.find(node => node.type === "IfStatement" && node.test?.right?.value === "link-candidate");
 requireOrderedStatements(callback?.consequent.body ?? [],"await linkIdentity(pool,flow.context.target,upstream.serverMetadata().issuer,claims.sub,flow.context.startedAt,config.lifecycleKey);",message);
 const entry = nodes.find(node => node.type === "IfStatement" && node.test?.right?.value === "/account/link");
 requireOrderedStatements(entry?.consequent.body ?? [],'await upstreamRedirect(res,{stage:"link-candidate",target:flow.context.target,startedAt:flow.initiatedAt});',message);
}
export function checkEraseRecovery(source) {
 const nodes = parsedNodes(source);
 const entry = nodes.find(node => node.type === "IfStatement" && node.test.type === "LogicalExpression" && node.test.left.right?.value === "/account/erase-status" && node.test.right.right?.value === "GET");
 const body = entry?.consequent.body ?? [];
 const html = body.find(node => node.type === "ExpressionStatement" && member(node.expression.callee,"res","end"))?.expression.arguments[0];
 const page = html?.type === "TemplateLiteral" && html.expressions.length === 0 ? html.quasis[0].value.cooked : "";
 const headers = body.find(node => node.type === "ExpressionStatement" && member(node.expression.callee,"res","writeHead"))?.expression.arguments[1]?.properties ?? [];
 const header = name => headers.find(node => node.key.value === name)?.value.value;
 const linked = nodes.some(node => node.type === "TemplateElement" && node.value.cooked.includes('href="/account/erase-status"'));
 if (!page.includes('<form method="post" action="/account/erase-status">') || !page.includes('name="status"') || !header("content-security-policy")?.includes("form-action 'self'") || header("cache-control") !== "no-store" || !linked || body.at(-1)?.type !== "ReturnStatement") throw new Error("Expose a credential-free GET recovery form linked before erasure; submit status secrets by same-origin POST");
}
export function checkExplicitEnrollment(source) {
 const nodes = parsedNodes(source);
 const sql = nodes.flatMap(node => node.type === "StringLiteral" ? [node.value] : node.type === "TemplateLiteral" ? [node.quasis.map(quasi => quasi.value.cooked ?? quasi.value.raw).join(" ")] : []);
 if (sql.some(value => /\bINSERT\s+INTO\s+(?:[\w"]+\.)?"?(?:hunt_accounts|oauth_identities)"?\b/i.test(value))) throw new Error("Unknown identity resolution cannot provision; use explicit browser enrollment");
}
export function checkBrowserFlowClock(issuer,flows) {
 const issuerNodes = parsedNodes(issuer);
 const redirect = issuerNodes.find(node => node.type === "FunctionDeclaration" && node.id?.name === "upstreamRedirect");
 const initial = astNodes(redirect).find(node => node.type === "CallExpression" && node.callee.name === "persistBrowserFlow");
 const writes = issuerNodes.filter(node => node.type === "CallExpression" && ["writeBrowserFlow","persistBrowserFlow"].includes(node.callee.name));
 const invalidPayload = writes.some(write => {
  const payload = write.arguments[2];
  if (payload?.type !== "ObjectExpression") return true;
  const properties = payload.properties;
  const preserved = properties[0]?.type === "SpreadElement" && properties[0].argument.name === "flow";
  const fields = write === initial ? properties : properties.slice(1);
  return (write !== initial && !preserved) || fields.some(node => node.type !== "ObjectProperty" || node.computed || (node.key.name ?? node.key.value) === "initiatedAt") || astNodes(payload).some(node => node.type === "CallExpression" && node.callee.object?.name === "Date");
 });
 const flowNodes = parsedNodes(flows);
 const timestamp = flowNodes.find(node => node.type === "VariableDeclarator" && node.id.name === "initiatedAt")?.init;
 const preservedTimestamp = timestamp?.type === "LogicalExpression" && timestamp.operator === "??" && member(timestamp.left,"value","initiatedAt");
 const databaseClock = astNodes(timestamp?.right).some(node => node.type === "CallExpression" && member(node.callee,"client","query") && node.arguments[0]?.value === "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS initiated_at");
 if (!initial || invalidPayload || !preservedTimestamp || !databaseClock || flowNodes.some(node => node.type === "CallExpression" && member(node.callee,"Date","now"))) throw new Error("Stamp new browser flows with the database clock; preserve that start through confirmations");
}
export function checkMemoryVerification(skill,index) {
 if (!skill.split("---")[1]?.includes("P06") || !skill.split("## Completion")[0].includes("features/memory.md") || !skill.includes("For identity linking, also load [memory and erasure](features/memory.md)") || !index.includes("[memory and erasure](memory.md)")) throw new Error("Route Memory, linking and erasure changes to features/memory.md");
}
