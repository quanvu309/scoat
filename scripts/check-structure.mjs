import { checkLoginCodes } from "./check-login.mjs";
import { checkBrowserTokens, checkBrowserPages, checkBrowserOutcomes, checkBrowserDocument, checkBrowserVisual } from "./check-browser-ui.mjs";

import fs from "node:fs";
import { parse } from "@babel/parser";
import { parse as yaml } from "yaml";
import { schemas, toolCatalog, promptInput, descriptors } from "../dist/mcp/index.js";
import { publicSourceUrl } from "../dist/knowledge/index.js";
import { z } from "zod";
import { checkAcceptanceAuthority, checkFixtureWorker, checkAcceptanceVerification, checkAcceptanceLinkCapture } from "./check-acceptance.mjs";
import { checkPerfStory } from "./check-perf.mjs";
import { checkMigrationAdmission, checkJournalReadiness, checkRequestLineage, checkFixtureJournal } from "./check-runtime-lineage.mjs";
import { checkReadiness, checkReleaseOwner, checkPoolOwner, checkListenHost, checkHostedCoverage, checkLaneTools, checkDeployUnits, checkOperationsVerification, checkRailwayRuntime } from "./check-operations.mjs";
import { checkLineageFence, checkLineageBegin, checkLineageIdentity, checkRuntimeAdmission, checkRecoveryAuthority, checkRecoveryVerification, checkLineageVerification, checkRecoveryDocumentation } from "./check-lineage.mjs";

export function checkSdkImports(file, source) {
  if (!file.startsWith("src/")) return;
  const adapter = file.startsWith("src/mcp/") || file === "src/server.ts" || file === "src/card/adapter.ts";
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
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
  if (Array.isArray(schema.items) || ["additionalItems", "prefixItems", "dependencies", "dependentRequired", "dependentSchemas", "$recursiveRef", "$recursiveAnchor", "$dynamicRef", "$dynamicAnchor", "unevaluatedItems", "unevaluatedProperties", "minContains", "maxContains"].some(key => Object.hasOwn(schema, key))) throw new Error("Publish the shared draft-7/2020-12 schema subset: homogeneous object or boolean items, without draft-specific keywords");
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
  checkHostedCoverage(source);
}
export function checkTestTimeouts(manifest) {
 if (manifest.scripts?.test !== "node --import ./scripts/test-deadline.mjs --test --test-reporter=spec --test-timeout=120000 test/*.test.mjs test/*.test.ts") throw new Error("Bound every test to two minutes and every test file to three minutes without forcing successful exits");
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(file); else if (/\.[cm]?[jt]sx?$/.test(file)) {
      const source = fs.readFileSync(file, "utf8");
      checkSdkImports(file, source);
      checkControlImports(file,source);
      checkScratchAllocation(file, source);
      if (file.startsWith("src/auth/") || file === "src/server.ts" || file === "src/browser/login.ts") checkBrowserPages({ [file]: source });
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
  const ast=parse(source,{sourceType:"module",plugins:["typescript"]});
  if(astNodes(ast).some(node=>node.type==="Identifier" && node.name==="person")) throw new Error("Legacy person mint must be removed; browser verification owns authority");
}
export function checkHostConfig(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
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
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
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
 checkTestTimeouts(JSON.parse(fs.readFileSync("package.json", "utf8")));
  const runtimeLineage = { database: fs.readFileSync("scripts/database.mjs", "utf8"), lineage: fs.readFileSync("src/db/lineage.ts", "utf8"), journal: fs.readFileSync("src/db/journal.ts", "utf8") };
  checkMigrationAdmission(runtimeLineage);
  checkFixtureJournal({ fixture: fs.readFileSync("scripts/auth-fixture.mjs", "utf8"), journal: fs.readFileSync("scripts/fixture-journal.mjs", "utf8") });
  checkJournalReadiness({ readiness: fs.readFileSync("src/readiness.ts", "utf8"), lineage: runtimeLineage.lineage, journal: runtimeLineage.journal });
  checkRequestLineage(fs.readFileSync("src/server.ts", "utf8"));
  const lineageSources = [];
  const collectSources = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const file = directory + "/" + entry.name; if (entry.isDirectory()) collectSources(file); else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) lineageSources.push({ file, source: fs.readFileSync(file, "utf8") }); } };
  collectSources("src");
  checkLineageFence(lineageSources);
  checkLineageBegin(fs.readFileSync("src/db/lineage.ts", "utf8"), fs.readFileSync("src/db/transaction.ts", "utf8"));
  checkLineageIdentity(fs.readFileSync("db/migrations/0004_lineage.sql", "utf8"), fs.readFileSync("src/db/lineage.ts", "utf8"), fs.readFileSync("src/db/schema.ts", "utf8"), fs.readFileSync("db/migrations/meta/_journal.json", "utf8"));
  checkRuntimeAdmission({ server: fs.readFileSync("src/server.ts", "utf8"), worker: fs.readFileSync("src/worker.ts", "utf8"), queue: fs.readFileSync("src/queue/index.ts", "utf8"), watches: fs.readFileSync("src/memory/watches.ts", "utf8"), lineage: fs.readFileSync("src/db/lineage.ts", "utf8"), index: fs.readFileSync("src/index.ts", "utf8") });
  checkRecoveryAuthority({ handoff: fs.readFileSync("src/recovery/handoff.ts", "utf8"), recovery: fs.readFileSync("src/recovery.ts", "utf8"), tools: fs.readFileSync("src/recovery/tools.ts", "utf8"), index: fs.readFileSync("src/index.ts", "utf8") });
  checkRecoveryVerification(fs.readFileSync(".agents/skills/verify-scoat/SKILL.md", "utf8"), fs.readFileSync(".agents/skills/verify-scoat/features/README.md", "utf8"), fs.readFileSync("scripts/verify.mjs", "utf8"));
  checkLineageVerification(fs.readFileSync(".agents/skills/verify-scoat/SKILL.md", "utf8"), fs.readFileSync(".agents/skills/verify-scoat/features/README.md", "utf8"), fs.readFileSync("scripts/verify.mjs", "utf8"));
  checkRecoveryDocumentation({ readme: fs.readFileSync("README.md", "utf8"), index: fs.readFileSync(".agents/skills/verify-scoat/features/README.md", "utf8"), recovery: fs.readFileSync("docs/recovery.md", "utf8"), operations: fs.readFileSync("docs/operations.md", "utf8"), lineage: fs.readFileSync(".agents/skills/verify-scoat/features/lineage.md", "utf8") });
  checkRemoteBoundary(fs.readFileSync("src/server.ts", "utf8"));
  checkErasureCoordinator(fs.readFileSync("src/accounts/erasure.ts", "utf8"));
  checkExplicitEnrollment(fs.readFileSync("src/auth/identity.ts", "utf8"));
  checkBrowserFlowClock(fs.readFileSync("src/auth/issuer.ts", "utf8"),fs.readFileSync("src/auth/flows.ts", "utf8"));
  checkBrowserDocument(fs.readFileSync("src/browser/page.ts", "utf8"));
  checkBrowserVisual({ workflow: fs.readFileSync(".github/workflows/ci.yaml", "utf8"), driver: fs.readFileSync("scripts/verify.mjs", "utf8"), skill: fs.readFileSync(".agents/skills/verify-scoat/SKILL.md", "utf8"), selector: fs.readFileSync(".agents/skills/verify-scoat/SKILL.md", "utf8"), index: fs.readFileSync(".agents/skills/verify-scoat/features/README.md", "utf8") });
  checkBrowserOutcomes(fs.readFileSync("src/auth/issuer.ts", "utf8"), fs.readFileSync("src/server.ts", "utf8"));
  checkBrowserPages(Object.fromEntries(["src/auth/issuer.ts", "src/server.ts", "src/browser/login.ts"].map(file => [file, fs.readFileSync(file, "utf8")])));
  checkBrowserTokens(fs.readFileSync("landing/public/ui.css", "utf8"), Object.fromEntries(["landing/public/styles.css", "landing/public/connect.css", "landing/public/account.css"].map(file => [file, fs.readFileSync(file, "utf8")])), Object.fromEntries(["landing/public/index.html", "landing/public/connect/index.html"].map(file => [file, fs.readFileSync(file, "utf8")])));
  checkEraseRecovery(fs.readFileSync("src/auth/issuer.ts", "utf8"));
  checkLinkSuppression(fs.readFileSync("src/auth/issuer.ts", "utf8"),fs.readFileSync("src/auth/link.ts", "utf8"));
  checkControlPrerequisites(fs.readFileSync("src/hunt/index.ts", "utf8"),fs.readFileSync("src/mcp/index.ts", "utf8"));
  checkControlVerification(fs.readFileSync(".agents/skills/verify-scoat/SKILL.md","utf8"),fs.readFileSync(".agents/skills/verify-scoat/features/README.md","utf8"),fs.readFileSync("scripts/verify.mjs","utf8"));
  checkMemoryVerification(fs.readFileSync(".agents/skills/verify-scoat/SKILL.md", "utf8"),fs.readFileSync(".agents/skills/verify-scoat/features/README.md", "utf8"));
  checkPublicAuthority(fs.readFileSync("src/index.ts", "utf8"));
  checkGrantRenewal(fs.readFileSync("src/auth/grants.ts", "utf8"));
  checkConsentDecision(fs.readFileSync("src/auth/issuer.ts", "utf8"));
  checkAuthorizationPolicy(fs.readFileSync("src/auth/issuer.ts", "utf8"));
  checkLoginCodes(...["src/auth/login.ts","src/auth/issuer.ts","src/auth/erasure.ts","src/auth/flows.ts","src/auth/config.ts","package.json","src/auth/adapter.ts"].map(file=>fs.readFileSync(file,"utf8")));
  checkConnectionPolicy(fs.readFileSync("src/auth/issuer.ts", "utf8"), fs.readFileSync("src/auth/registration.ts", "utf8"), fs.readFileSync("src/auth/adapter.ts", "utf8"), fs.readFileSync("src/server.ts", "utf8"));
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
  const entries = Object.fromEntries(descriptors().map(entry => [entry.name, entry]));
  checkOutputContract(entries, fs.readFileSync("src/mcp/index.ts", "utf8"), fs.readFileSync("src/mcp/results.ts", "utf8"));
  checkToolDescriptors(entries, toolCatalog, fs.readFileSync("src/mcp/index.ts", "utf8"));
  checkWire(z.toJSONSchema(promptInput, { target: "draft-7" }));
  for (const file of fs.readdirSync("knowledge/releases")) if (file.endsWith(".json")) checkReleaseSources(JSON.parse(fs.readFileSync(`knowledge/releases/${file}`, "utf8")));
  checkTools(Object.keys(toolCatalog));
  checkWorkflow(fs.readFileSync(".github/workflows/ci.yaml", "utf8"));
  checkDependencyPair(JSON.parse(fs.readFileSync("package.json", "utf8")));
  const adapter = fs.readFileSync("src/mcp/index.ts", "utf8");
  checkPersonBoundary(adapter);
  checkBrowserControls(fs.readFileSync("src/controls/codec.ts","utf8"),fs.readFileSync("src/hunt/index.ts","utf8"));
  checkRegistryAdapter(adapter);
  checkHostConfig(fs.readFileSync("src/server.ts", "utf8"));
  checkListenHost(fs.readFileSync("src/server.ts", "utf8"));
  checkReadiness({ server: fs.readFileSync("src/server.ts", "utf8"), worker: fs.readFileSync("src/worker.ts", "utf8"), readiness: fs.readFileSync("src/readiness.ts", "utf8"), database: fs.readFileSync("scripts/database.mjs", "utf8") });
  checkReleaseOwner({ release: fs.readFileSync("src/release.ts", "utf8"), build: fs.readFileSync("scripts/build.mjs", "utf8"), sources: lineageSources });
  checkPoolOwner(lineageSources);
  checkLaneTools(["scripts/verify-lineage.mjs", "scripts/verify-recovery.mjs", "scripts/perf-lineage.mjs", "scripts/verify-operations.mjs", "scripts/lane-tools.mjs"].map(file => ({ file, source: fs.readFileSync(file, "utf8") })));
  checkDeployUnits({ migrate: fs.readFileSync("deploy/systemd/scoat-migrate.service", "utf8"), server: fs.readFileSync("deploy/systemd/scoat-server.service", "utf8"), worker: fs.readFileSync("deploy/systemd/scoat-worker.service", "utf8"), env: fs.readFileSync("deploy/scoat.env.example", "utf8") });
  checkRailwayRuntime({ dockerfile: fs.readFileSync("Dockerfile", "utf8"), dockerignore: fs.readFileSync(".dockerignore", "utf8"), manifest: fs.readFileSync("deploy/railway/services.json", "utf8"), runtime: fs.readFileSync("src/railway.ts", "utf8") });
  checkOperationsVerification(fs.readFileSync(".agents/skills/verify-scoat/SKILL.md", "utf8"), fs.readFileSync(".agents/skills/verify-scoat/features/README.md", "utf8"), fs.readFileSync("scripts/verify.mjs", "utf8"), fs.readFileSync("scripts/perf.mjs", "utf8"));
  checkAcceptanceAuthority({ story: fs.readFileSync("scripts/story-lanes.mjs", "utf8"), conditions: fs.readFileSync("scripts/story-conditions.mjs", "utf8") });
  checkAcceptanceLinkCapture(fs.readFileSync("scripts/story-lanes.mjs", "utf8"));
  checkPerfStory({ entry: fs.readFileSync("scripts/perf.mjs", "utf8"), p09: fs.readFileSync("scripts/perf-p09.mjs", "utf8"), story: fs.readFileSync("scripts/perf-story.mjs", "utf8"), lineage: fs.readFileSync("scripts/perf-lineage.mjs", "utf8") });
  checkFixtureWorker(fs.readFileSync("scripts/watch-worker.mjs", "utf8"));
  checkAcceptanceVerification(fs.readFileSync(".agents/skills/verify-scoat/SKILL.md", "utf8"), fs.readFileSync(".agents/skills/verify-scoat/features/README.md", "utf8"), fs.readFileSync("scripts/verify.mjs", "utf8"), fs.readFileSync(".github/workflows/ci.yaml", "utf8"));
  checkTypeConfig(JSON.parse(fs.readFileSync("tsconfig.json", "utf8")));
  checkDriver(fs.readFileSync("scripts/driver.mjs", "utf8"));
}

export function checkKnowledgeTypes(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (["TSParameterProperty", "TSEnumDeclaration", "TSModuleDeclaration"].includes(node.type)) throw new Error("Knowledge must use erasable TypeScript for Node strip-only tests; declare fields explicitly");
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(ast.program);
}

export function checkHuntAuthority(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (["TSTypeAliasDeclaration","TSInterfaceDeclaration"].includes(node.type) && node.id?.name === "Person") throw new Error("Replace structural Person with nominal verified control authority");
    if (node.type === "TSPropertySignature" && node.key?.name === "stackProof") throw new Error("Replace unbound stackProof with exact-set compatibility authority");
    if (node.type === "TSPropertySignature" && node.key?.name === "__brand") throw new Error("Derive identifier brands from validated schemas using z.$brand");
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(ast.program);
}

export function checkCandidateSearch(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "CallExpression" && node.callee?.property?.name === "sort" && JSON.stringify(node.arguments).includes('"name":"key"')) throw new Error("Precompute candidate rank keys before sorting");
    if (node.type === "BinaryExpression" && node.operator === "**" && node.right?.type === "MemberExpression" && node.right.object?.name === "benefits" && node.right.property?.name === "length") throw new Error("Enumerate authorized complete sets rather than generating unsupported benefit subsets");
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(ast.program);
}

export function checkViewCoverage(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
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
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const evidence = ast.program.body.find(node => node.declaration?.id?.name === "parseEvidence")?.declaration;
  if (evidence && !astNodes(evidence).some(node => node.type === "CallExpression" && node.callee?.name === "isOfficialSource")) throw new Error("Validate retailer-tested code against isOfficialSource and the pinned release; origin labels are not authority");
}
export function checkScratchAllocation(file, source) {
  if (file === "scripts/scratch.mjs") return;
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if ((node.type === "ImportSpecifier" && node.imported?.name === "mkdtemp") || (node.type === "CallExpression" && (node.callee?.name === "mkdtemp" || node.callee?.property?.name === "mkdtemp"))) throw new Error(`${file}: use scratchDirectory so an absent ~/tmp parent is created before allocation`);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(ast.program);
}
export function checkScenarioProjection(domain, hunt) {
  const domainNodes = astNodes(parse(domain, { sourceType: "module", plugins: ["typescript", "jsx"] }));
  for (const conditional of domainNodes.filter(node => node.type === "TSPropertySignature" && node.key?.name === "conditional")) {
    const fields = new Set(astNodes(conditional.typeAnnotation).filter(node => node.type === "TSPropertySignature").map(node => node.key?.name));
    if (["selection", "backLater", "perks"].some(field => !fields.has(field))) throw new Error("Each conditional scenario must retain selection, backLater and perks from its authorized offer set");
  }
  const huntNodes = astNodes(parse(hunt, { sourceType: "module", plugins: ["typescript", "jsx"] }));
  const view = huntNodes.find(node => node.type === "TSTypeAliasDeclaration" && node.id?.name === "HuntView");
  if (view && !astNodes(view).some(node => node.type === "TSPropertySignature" && node.key?.name === "quotes")) throw new Error("Retain all quotes in HuntView so structured and text renderers share every scenario");
}

export function checkDurableFences(source) {
  if (/lockAll|ISOLATION LEVEL SERIALIZABLE/.test(source)) throw new Error("Use named READ COMMITTED account/hunt fences and addressed rows");
  if (!source.includes("await begin(client);") || !source.includes("Inactive account incarnation")) throw new Error("Fence every transaction on the persisted account incarnation");
}

export function checkStartReplay(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const method = astNodes(ast).find(node => node.type === "ClassMethod" && node.key?.name === "run");
  const calls = astNodes(method).filter(node => node.type === "CallExpression");
  const replay = calls.find(node => node.callee?.property?.name === "priorReceipt");
  const knowledge = calls.find(node => node.callee?.property?.name === "read" && node.callee.object?.property?.name === "knowledge");
  if (!replay || !knowledge || replay.start > knowledge.start) throw new Error("Probe the fenced receipt before start knowledge loading so old replays survive provider failure");
}

export function checkDurableCommands(source) {
  const nodes = astNodes(parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] }));
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
  const authorityImports = new Set(nodes.filter(node => node.type === "ImportDeclaration" && node.importKind !== "type" && /\/(?:auth|controls)(?:\/|$)/.test(node.source.value)).flatMap(node => node.specifiers.filter(specifier => specifier.importKind !== "type").map(specifier => specifier.local.name)));
  for (const node of nodes) {
    if (node.exportKind === "type") continue;
    if (((node.type === "ExportDefaultDeclaration" || node.type === "ExportNamedDeclaration") && astNodes(node.declaration).some(part => part.type === "Identifier" && authorityImports.has(part.name))) || node.type === "ExportAllDeclaration" || (node.type === "ExportNamedDeclaration" && /\/(?:auth|controls)(?:\/|$)/.test(node.source?.value ?? "")) || (node.type === "ExportSpecifier" && node.exportKind !== "type" && (authorityImports.has(node.local?.name) || ["authenticate","person","principalFor","resolveIdentity","mount"].includes(node.local?.name)))) throw new Error("Keep runtime principal constructors and authority adapters out of the public barrel; use named value exports");
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
  const disabled = ["registration", "dPoP", "pushedAuthorizationRequests", "userinfo", "rpInitiatedLogout"].every(name => features.find(node => node.key?.name === name)?.value.properties?.some(node => node.key?.name === "enabled" && node.value?.value === false));
  if (JSON.stringify(responseTypes?.elements?.map(node => node.value)) !== '["code"]' || JSON.stringify(scopes?.elements?.map(node => node.value)) !== '["openid","offline_access"]' || !disabled) throw new Error("Advertise only the shipped authorization-code flow and disable unused issuer endpoints");
}
export function checkBrowserLink(source) {
  const nodes = parsedNodes(source);
  const link = nodes.find(node => node.type === "IfStatement" && node.test.type === "BinaryExpression" && node.test.right?.value === "/account/link");
  const body = link?.consequent.body ?? [];
  const entry = body.find(node => node.type === "IfStatement" && node.test.right?.value === "GET" && astNodes(node.consequent).some(call => call.type === "CallExpression" && call.callee?.name === "loginRedirect" && call.arguments[1]?.properties?.some(property => property.value?.value === "link-current")));
  const consumed = astNodes(link).find(node => node.type === "CallExpression" && member(node.callee,"client","query") && node.arguments[0]?.value === "DELETE FROM oauth_browser_flows WHERE state=$1 AND expires_at>now() RETURNING data");
  const bound = body.find(node => node.type === "IfStatement" && astNodes(node.test).some(test => test.type === "BinaryExpression" && test.operator === "!==" && test.right?.value === "link-confirm") && node.consequent.type === "ThrowStatement");
  const candidate = astNodes(link).find(node => node.type === "CallExpression" && node.callee?.name === "loginRedirect" && node.arguments[1]?.properties?.some(property => property.value?.value === "link-candidate"));
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
 const watches = await deleteWatches(client,scope);
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
 await begin(client);
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[JSON.stringify([issuer,subject])]);
 const pseudonym = createHmac("sha256",lifecycleKey).update(JSON.stringify([issuer,subject])).digest("hex");
 const suppressed = await client.query("SELECT 1 FROM account_suppression WHERE subject_digest=$1 AND erased_at>=to_timestamp($2/1000.0) AND purge_after>now() LIMIT 1",[pseudonym,startedAt]);
 if (suppressed.rowCount) throw new Error("Link flow predates erasure; start linking again");
 const existing = (await client.query("SELECT account,incarnation FROM oauth_identities WHERE issuer=$1 AND subject=$2",[issuer,subject])).rows[0];
 `,message);
 const nodes = parsedNodes(issuer);
 const callback = nodes.find(node => node.type === "IfStatement" && node.test?.right?.value === "link-candidate");
 requireOrderedStatements(callback?.consequent.body ?? [],"await linkIdentity(pool,flow.context.target,issuer,claims.sub,flow.context.startedAt,config.lifecycleKey);",message);
 const entry = nodes.find(node => node.type === "IfStatement" && node.test?.right?.value === "/account/link");
 requireOrderedStatements(entry?.consequent.body ?? [],'await loginRedirect(res,{stage:"link-candidate",target:flow.context.target,startedAt:flow.initiatedAt});',message);
}
export function checkEraseRecovery(source, views = fs.readFileSync("src/browser/views.ts", "utf8")) {
 const nodes = parsedNodes(source);
 const entry = nodes.find(node => node.type === "IfStatement" && node.test.type === "LogicalExpression" && node.test.left.right?.value === "/account/erase-status" && node.test.right.right?.value === "GET");
 const body = entry?.consequent.body ?? [];
 const renders = body.some(node => node.type === "ExpressionStatement" && node.expression.callee?.name === "sendPage" && member(node.expression.arguments[1]?.callee,"pages","eraseStatus"));
 const view = method(parsedNodes(views), "eraseStatus");
 const page = renders && view ? views.slice(view.start,view.end) : "";
 const headers = body.find(node => node.type === "ExpressionStatement" && node.expression.callee?.name === "pageHead")?.expression.arguments[2]?.properties ?? [];
 const header = name => headers.find(node => node.key.value === name)?.value.value;
 const linked = views.includes('href="/account/erase-status"');
 if (!page.includes('<form method="post" action="/account/erase-status">') || !page.includes('name="status"') || !header("content-security-policy")?.includes("form-action 'self'") || header("cache-control") !== "no-store" || header("referrer-policy") !== "same-origin" || !linked || body.at(-1)?.type !== "ReturnStatement") throw new Error("Expose a credential-free GET recovery form linked before erasure; submit status secrets by same-origin POST with same-origin Referrer-Policy");
 const confirmation = nodes.find(node => node.type === "IfStatement" && node.test.right?.value === "erase" && node.test.left?.property?.name === "stage");
 const confirmationHeaders = astNodes(confirmation).find(node => node.type === "CallExpression" && node.callee?.name === "pageHead")?.arguments[2]?.properties ?? [];
 if (!["cache-control","referrer-policy"].every((name,index) => confirmationHeaders.some(node => node.key.value === name && node.value.value === ["no-store","same-origin"][index]))) throw new Error("Serve the erase confirmation status secret with no-store and same-origin Referrer-Policy");
}
export function checkExplicitEnrollment(source) {
 const nodes = parsedNodes(source);
 const sql = nodes.flatMap(node => node.type === "StringLiteral" ? [node.value] : node.type === "TemplateLiteral" ? [node.quasis.map(quasi => quasi.value.cooked ?? quasi.value.raw).join(" ")] : []);
 if (sql.some(value => /\bINSERT\s+INTO\s+(?:[\w"]+\.)?"?(?:hunt_accounts|oauth_identities)"?\b/i.test(value))) throw new Error("Unknown identity resolution cannot provision; use explicit browser enrollment");
}
export function checkBrowserFlowClock(issuer,flows) {
 const issuerNodes = parsedNodes(issuer);
 const redirect = issuerNodes.find(node => node.type === "FunctionDeclaration" && node.id?.name === "loginRedirect");
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

export function checkControlPrerequisites(hunt,wire) {
 const nodes=parsedNodes(hunt);
 const run=nodes.find(node=>node.type==="ClassMethod" && node.key.name==="run");
 const guard=run?.body.body[0];
 const test=guard?.test;
 const parse=test?.right?.argument?.object;
 const returned=guard?.consequent;
 const valid=guard?.type==="IfStatement" && test?.type==="LogicalExpression" && test.operator==="&&"
  && test.left.type==="BinaryExpression" && test.left.operator==="in" && test.left.left.value==="requestKey" && test.left.right.name==="request"
  && test.right.type==="UnaryExpression" && test.right.operator==="!" && test.right.argument.property?.name==="success"
  && parse?.type==="CallExpression" && member(parse.callee,"agentRequestKey","safeParse") && parse.arguments.length===1 && member(parse.arguments[0],"request","requestKey")
  && returned?.type==="ReturnStatement" && returned.argument.callee?.name==="failure" && returned.argument.arguments[0]?.value==="invalid";
 const wireNodes=parsedNodes(wire);
 const input=wireNodes.find(node=>node.type==="VariableDeclarator" && node.id.name==="huntInput");
 const keys=astNodes(input).filter(node=>node.type==="ObjectProperty" && node.key.name==="requestKey");
 if (!valid || keys.length!==4 || keys.some(node=>node.value.name!=="agentRequestKey")) throw new Error("Reserve person receipt keys at the live wire and first agent domain boundary");
 const control=nodes.find(node=>node.type==="ClassMethod" && node.key.name==="control");
 const stop=astNodes(control).find(node=>node.type==="IfStatement" && node.test.type==="BinaryExpression" && member(node.test.left,"control","kind") && node.test.right.value==="stop");
 const preserved=stop?.consequent.body?.[0];
 if (preserved?.type!=="IfStatement" || preserved.test.operator!=="===" || preserved.test.left?.property?.name!=="stopRequestedAt" || !member(preserved.test.left?.object,"state","hunt") || preserved.test.right?.type!=="NullLiteral" || (preserved.consequent?.expression ?? preserved.consequent?.body?.[0]?.expression)?.type!=="AwaitExpression" || !member((preserved.consequent.expression ?? preserved.consequent.body?.[0]?.expression).argument?.callee,"tx","putHunt")) throw new Error("Preserve the first accepted Stop timestamp");
}

export function checkBrowserControls(codec,hunt) {
 const nodes=parsedNodes(codec);
 const issue=nodes.find(node=>node.type==="ClassMethod" && node.key.name==="issue");
 const deadline=astNodes(issue).find(node=>node.type==="ObjectProperty" && node.key.name==="deadline");
 if(deadline?.value.type!=="BinaryExpression" || !member(deadline.value.left?.callee,"Math","floor") || deadline.value.left.arguments[0]?.name!=="databaseTime") throw new Error("Round database milliseconds before signing the strict integer deadline");
 const verify=nodes.find(node=>node.type==="ClassMethod" && node.key.name==="verify");
 const constructions=nodes.filter(node=>node.type==="NewExpression" && node.callee.name==="Authority");
 if(constructions.length!==1 || constructions[0].start<verify?.start || constructions[0].end>verify?.end) throw new Error("Only verified browser confirmation constructs authority");
 const authorityUses=new Set(nodes.flatMap(node=>node.type==="ClassDeclaration" && node.id?.name==="Authority"?[node.id]:node.type==="TSTypeReference" && node.typeName.name==="Authority"?[node.typeName]:[]));
 authorityUses.add(constructions[0].callee);
 if(nodes.some(node=>node.type==="Identifier" && node.name==="Authority" && !authorityUses.has(node))) throw new Error("Only verified browser confirmation constructs authority; never alias or reflect its constructor");
 const authority=nodes.find(node=>node.type==="ClassDeclaration" && node.id?.name==="Authority");
 const constructor=authority?.body.body.find(node=>node.type==="ClassMethod" && node.kind==="constructor");
 const enrollments=nodes.filter(node=>node.type==="CallExpression" && member(node.callee,"valid","add"));
 if(enrollments.length!==1 || enrollments[0].start<constructor?.start || enrollments[0].end>constructor?.end || enrollments[0].arguments.length!==1 || enrollments[0].arguments[0].type!=="ThisExpression") throw new Error("Enroll only this authority inside its constructor");
 const guard=nodes.find(node=>node.type==="FunctionDeclaration" && node.id.name==="verifiedControl");
 const first=guard?.body.body[0];
 if(first?.type!=="IfStatement" || first.test.type!=="UnaryExpression" || !member(first.test.argument?.callee,"valid","has") || first.consequent.type!=="ThrowStatement") throw new Error("Check runtime authority identity before storage");
 const control=parsedNodes(hunt).find(node=>node.type==="ClassMethod" && node.key.name==="control");
 const initial=control?.body.body[0]?.declarations?.[0]?.init;
 if(initial?.callee?.name!=="verifiedControl") throw new Error("Check runtime authority identity before storage");
 if(!astNodes(control).some(node=>node.type==="AwaitExpression" && member(node.argument?.callee,"tx","databaseTime"))) throw new Error("Check control expiry with transaction database time");
}

export function checkControlVerification(skill,index,runner) {
 if(!skill.split("---")[1]?.includes("P07 browser-authorized Stop and Skip") || !skill.split("## Completion")[0].includes("features/controls.md") || !index.includes("[browser controls](controls.md)") || !runner.includes('process.argv[2] === "p07-controls"') || !runner.includes('import("./verify-controls.mjs")')) throw new Error("Route browser controls to features/controls.md and the runnable p07-controls branch");
}

export function checkControlImports(file,source) {
 if(!file.startsWith("src/mcp/"))return;
 const nodes=parsedNodes(source);
 if(nodes.some(node=>node.type==="ImportExpression" || node.type==="CallExpression" && node.callee.type==="Import")) throw new Error("MCP cannot import codec authority dynamically; keep imports static and auditable");
 if(nodes.some(node=>(node.type==="ExportNamedDeclaration" || node.type==="ExportAllDeclaration") && node.source?.value.includes("/controls/"))) throw new Error("MCP cannot import codec authority through re-exports");
 for(const node of nodes.filter(node=>node.type==="ImportDeclaration" && node.source.value.includes("/controls/"))) {
  if(node.specifiers.some(item=>(node.importKind!=="type" && item.importKind!=="type") || item.imported?.name!=="ControlLinksFor"))throw new Error("MCP cannot import codec authority; accept only the control link function type");
 }
}

export function checkWatchSender(source) {
 const nodes = parsedNodes(source);
 const send = nodes.find(node => node.type === "ClassMethod" && node.key.name === "send");
 const inner = astNodes(send);
 const submit = inner.find(node => node.type === "CallExpression" && member(node.callee?.object, "this", "deps") && node.callee.property?.name === "submit") ?? inner.find(node => node.type === "CallExpression" && node.callee?.property?.name === "submit");
 if (!send || !submit) throw new Error("Watches.send must submit through the delivery boundary");
 const markers = inner.filter(node => (node.type === "StringLiteral" || node.type === "TemplateLiteral") && /SET state='submitting',marked_at=/.test(node.value ?? node.quasis?.map(part => part.value.raw).join("")));
 const marker = markers[0];
 const markerTransaction = inner.find(node => node.type === "CallExpression" && node.callee?.name === "retryTransaction" && node.start < (marker?.start ?? 0) && node.end > (marker?.end ?? 0));
 const fencedMarker = markerTransaction && astNodes(markerTransaction).some(node => node.type === "CallExpression" && node.callee?.name === "activeAccount" && node.start < marker.start);
 if (markers.length !== 1 || !markerTransaction || !fencedMarker || markerTransaction.end > submit.start) throw new Error("Commit one fenced durable submission marker before provider network IO");
 const before = inner.filter(node => node.start > markerTransaction.end && node.end < submit.start);
 if (!before.some(node => node.type === "CallExpression" && node.callee?.name === "activeAccount")) throw new Error("Recheck the active account incarnation inside the send fence before submission");
 const revision = node => node.type === "BinaryExpression" && node.operator === "!==" && member(node.left, "recipient", "revision") && member(node.right, "alert", "recipient_revision");
 const gate = before.find(node => node.type === "IfStatement" && astNodes(node.test).some(revision));
 if (!gate) throw new Error("Refuse a changed recipient revision inside the send fence");
 if (!astNodes(gate.consequent).some(node => node.type === "ReturnStatement")) throw new Error("Return before submission when the send fence recheck fails");
 for (const [object, property, value, label] of [["watch", "status", "active", "watch status"], ["watch", "live", true, "watch expiry"], ["alert", "open", true, "retry deadline"]]) {
  if (!astNodes(gate.test).some(node => node.type === "BinaryExpression" && node.operator === "!==" && fieldOf(node.left, object, property) && node.right?.value === value)) throw new Error(`Recheck the ${label} inside the send fence before submission`);
 }
 const mailGate = inner.find(node => node.type === "IfStatement" && node.test.type === "UnaryExpression" && node.test.operator === "!" && node.test.argument?.type === "MemberExpression" && node.test.argument.property?.name === "canSubmit" && node.consequent.type === "ThrowStatement");
 if (!mailGate || mailGate.start > markerTransaction.start) throw new Error("Refuse an absent mail transport before writing a submission marker");
 const [message, , key, signal] = submit.arguments;
 if (!astNodes(message).some(node => member(node, "alert", "message")) || !astNodes(key).some(node => member(node, "alert", "provider_key"))) throw new Error("Submit the immutable stored payload and provider key on every retry");
 if (signal?.type !== "CallExpression" || !member(signal.callee, "AbortSignal", "timeout") || !member(signal.arguments[0], "watchLimits", "submitMilliseconds")) throw new Error("Bound provider submission with the watch submit deadline");
 if (!inner.some(node => node.type === "CallExpression" && member(node.callee, "client", "on") && node.arguments[0]?.value === "error")) throw new Error("Handle sender connection loss without crashing the worker");
 const guarded = inner.find(node => node.type === "TryStatement" && node.block.start < submit.start && node.block.end > submit.end);
 if (!astNodes(guarded?.finalizer).some(node => node.type === "CallExpression" && member(node.callee, "client", "release"))) throw new Error("Release the fenced sender connection on every return path");
}

function fieldOf(node, object, property) {
 return (node?.type === "MemberExpression" || node?.type === "OptionalMemberExpression") && node.object?.name === object && node.property?.name === property && !node.computed;
}
function sqlOf(owner) {
 return astNodes(owner).filter(node => node.type === "StringLiteral" || node.type === "TemplateLiteral").map(node => ({ node, text: node.value ?? node.quasis.map(part => part.value.raw).join("${}") }));
}
function method(nodes, name) {
 return nodes.find(node => (node.type === "ClassMethod" && node.key.name === name) || (node.type === "FunctionDeclaration" && node.id?.name === name));
}
export function checkWatchLockOrder(watches) {
 const nodes = parsedNodes(watches);
 const locking = owner => sqlOf(owner).filter(item => /\b(UPDATE|DELETE|INSERT)\b|FOR (SHARE|UPDATE)/.test(item.text) && !/pg_advisory/.test(item.text)).sort((a, b) => a.node.start - b.node.start);
 const plan = locking(method(nodes, "plan"));
 if (!plan.length || !/FROM hunt_accounts/.test(plan[0].text) || !/ORDER BY a\.account,a\.incarnation/.test(plan[0].text) || !/FOR SHARE/.test(plan[0].text)) throw new Error("Plan must lock sorted account fences before watch, alert or queue rows");
 const scope = sqlOf(method(nodes, "plan")).some(item => item.text === "(account,incarnation) IN (SELECT * FROM unnest($1::text[],$2::uuid[]))");
 if (!scope || plan.slice(1).some(item => !item.text.includes("WHERE ${} AND"))) throw new Error("Plan must scope watch and alert work to the fenced accounts");
 const horizon = plan.findIndex(item => /UPDATE watch_alerts/.test(item.text));
 if (horizon < 1 || !/FROM watches w[\s\S]*FOR SHARE/.test(plan[horizon - 1].text)) throw new Error("Plan must lock watch rows before alert rows");
 const planning = astNodes(method(nodes, "plan"));
 const advancing = planning.find(node => node.type === "AssignmentExpression" && node.operator === "=" && node.left?.name === "cursor" && fieldOf(node.right, "page", "last"));
 const loop = planning.find(node => node.type === "ForStatement" && node.test === null && node.start < plan[0].node.start && node.end > advancing?.end);
 if (!plan[0].text.includes("(a.account,a.incarnation)>($1::text,$2::uuid)") || !loop || !advancing || sqlOf(method(nodes, "plan")).some(item => !/FROM hunt_accounts/.test(item.text) && /FROM (watches w|watch_alerts) WHERE/.test(item.text) && /\bLIMIT\b/.test(item.text))) throw new Error("Plan must advance account keyset pages and enqueue every fenced watch and alert");
 const erase = locking(method(nodes, "deleteWatches"));
 if (!erase.length || !/SELECT id FROM watches[\s\S]*FOR UPDATE/.test(erase[0].text)) throw new Error("Erasure must lock watch rows before alert, recipient and queue rows");
}
export function checkWatchRecipient(watches) {
 const activate = method(parsedNodes(watches), "activate");
 const repoint = sqlOf(activate).filter(item => /UPDATE watches SET recipient_revision/.test(item.text));
 if (repoint.length !== 1 || /\bid=\$/.test(repoint[0].text) || !/status='active'/.test(repoint[0].text)) throw new Error("A recipient change must re-point every active watch, never only the new watch");
 if (!sqlOf(activate).some(item => /UPDATE watch_alerts SET recipient_revision[\s\S]*state='pending'/.test(item.text))) throw new Error("A recipient change must re-point unsubmitted alerts");
 const refusals = astNodes(activate).filter(node => node.type === "NewExpression" && node.callee?.name === "WatchRefusal" && node.arguments[0]?.value === "recipient-changed");
 if (refusals.length < 2) throw new Error("Refuse a recipient move without the confirmed revision and explicit consent");
}
export function checkWatchEntry(codec, contract, dispatch, renderer) {
 if (/watch\s*:/.test(codec)) throw new Error("Derive the canonical watch entry from the Memory watch aggregate, not a fixed codec reason");
 if (!/watch:z\.discriminatedUnion\("available",\[z\.strictObject\(\{available:z\.literal\(true\),url:https\}\)/.test(contract.replace(/\s/g, ""))) throw new Error("Card controls must carry the canonical watch link when available");
 if (!/watch: watchEntry\(/.test(dispatch) || !/controls\.watch\.available \? "Watch price: " \+ controls\.watch\.url/.test(dispatch)) throw new Error("Text and card controls must share one canonical watch entry");
 if (/Watch unavailable<\/button>/.test(renderer) || !/open\(controls\.watch\.url\)/.test(renderer)) throw new Error("The live card must open the canonical watch link");
 if (!renderer.includes("(hero || controls?.watch.available) && <button")) throw new Error("Keep an available canonical Watch action accessible without a saved quote");
}
export function checkWatchBoundary(issuer, watches, memory) {
 const issuerNodes = parsedNodes(issuer);
 const watchBlocks = issuerNodes.filter(node => node.type === "IfStatement" && astNodes(node.test).some(part => part.type === "StringLiteral" && (part.value === "/account/watch" || part.value === "watch"))).map(node => issuer.slice(node.start, node.end)).join("\n");
 if (!watchBlocks || /memory_commands|readFinishedResult|resolveWatchTarget|hunt_accounts/.test(watchBlocks) || /import[^;]*\b(readFinishedResult|resolveWatchTarget)\b/.test(issuer)) throw new Error("Keep watch preparation SQL in the Memory watch aggregate");
 if (/z\.object\(\{ op: z\.literal\("watch"\)/.test(issuer + watches + memory) || !/watchCommandSchema\.parse/.test(watches)) throw new Error("Parse watch proposals with the authoritative strict command schema");
 const prepare = method(parsedNodes(watches), "prepareWatch");
 const callers = ["activate"].map(name => method(parsedNodes(watches), name));
 if (!prepare || callers.some(owner => !astNodes(owner).some(node => node.type === "CallExpression" && node.callee?.name === "prepareWatch")) || !/prepareWatch\(client,caller,request\.hunt\)/.test(memory) || !/watches\.prepare\(target, hunt\)/.test(issuer)) throw new Error("Share one deep watch prepare operation across proposal, confirmation and activation");
 if (!/if \(!\(error instanceof WatchRefusal\)\) throw error;/.test(issuer) || !/if \(!pending\) throw new WatchRefusal\("expired"\)/.test(issuer)) throw new Error("Render typed watch refusals and keep unrelated failures generic");
 if (!/if \(watches && watches\.issuer !== issuer\) throw/.test(issuer) || !/url\.origin === value/.test(watches)) throw new Error("Use one authoritative issuer origin for watch unsubscribe links");
 const one = method(parsedNodes(issuer), "oneClick");
 const text = sqlOf(one).map(item => item.text).join("\n");
 if (!one || !text.includes("multipart/form-data") || !text.includes("application/x-www-form-urlencoded") || !astNodes(one).some(node => node.type === "BinaryExpression" && node.operator === ">" && node.left?.name === "size") || !astNodes(one).some(node => node.type === "BinaryExpression" && node.operator === "!==" && fieldOf(node.left, "entries", "length") && node.right?.value === 1) || !/await oneClick\(req\);/.test(issuer)) throw new Error("Accept bounded RFC 8058 one-click in multipart and urlencoded forms with exactly one field");
}
export function checkWatchActivation(watches, issuer, server, views = fs.readFileSync("src/browser/views.ts", "utf8")) {
 const nodes = parsedNodes(watches);
 const available = method(nodes, "available");
 if (!available || !/return this\.deps\.config\.resendApiKey !== null;/.test(watches.slice(available.start, available.end))) throw new Error("Watch availability requires a configured worker mail key");
 for (const name of ["prepare", "activate"]) {
  const owner = method(nodes, name);
  const first = owner?.body?.body?.[0];
  if (!first || !/^if \(!this\.available\)/.test(watches.slice(first.start, first.end))) throw new Error("Refuse unconfigured watch preparation and activation before state access");
 }
 if (!/if \(!watches\?\.available\) \{\s*pageHead\(res, 503, watchHeaders\)/.test(issuer) || !/watches\?\.available === true/.test(server) || !/watches\?\.available && issued\.finished/.test(views)) throw new Error("Route browser, MCP and control links through watch availability");
 const target = method(parsedNodes(issuer), "targetPence");
 const body = target ? issuer.slice(target.start, target.end) : "";
 if (!/watchTargetPence\.safeParse/.test(body) || !/if \(!amount\.success\) throw new WatchRefusal\("invalid-target"\)/.test(body) || !/if \(!pence\.success\) throw new WatchRefusal\("invalid-target"\)/.test(body)) throw new Error("Return typed invalid-target refusals for malformed and out-of-range prices");
 const caught = parsedNodes(issuer).some(node => node.type === "TryStatement" && node.handler && issuer.slice(node.handler.start, node.handler.end).includes("error instanceof WatchRefusal") && node.block.body.some(statement => statement.type === "VariableDeclaration" && statement.declarations.some(declaration => declaration.init?.type === "CallExpression" && declaration.init.callee?.name === "targetPence")));
 if (!caught) throw new Error("Parse browser target prices inside the typed watch-refusal boundary");
 const refusal = method(parsedNodes(views), "watchRefusalPage");
 const refusalBody = refusal ? views.slice(refusal.start, refusal.end) : "";
 if (!refusalBody.includes('form method="post" action="/account/watch"') || !refusalBody.includes('escapeHtml(correction.confirmation)') || !refusalBody.includes('correction.moveRecipient') || !issuer.includes('watchRefusalPage(error.reason, retry, { confirmation: fields.confirmation, moveRecipient: fields.recipient === "move" })')) throw new Error("Render an invalid-target correction form retaining the confirmation and recipient choice");
}
export function checkWatchWorker(worker, delivery) {
 const start = method(parsedNodes(worker), "startWorker");
 const first = start?.body.body[0];
 if (first?.type !== "IfStatement" || !/canSubmit/.test(worker.slice(first.test.start, first.test.end)) || first.consequent.type !== "ThrowStatement") throw new Error("Refuse worker startup without a mail transport before queue work");
 if (!/if \(config\.resendApiKey === null\) throw/.test(worker)) throw new Error("Refuse production worker startup without a mail key");
 if (/mail-unconfigured/.test(delivery)) throw new Error("An absent mail transport must never become ambiguous provider acceptance");
}
export function checkWatchQueueIsolation(queue, fixture, drivers = []) {
 if (drivers.some(source => /\b(?:FROM|UPDATE|INTO|JOIN) pgboss\./.test(source))) throw new Error("Queue verification and performance drivers must use the fixture namespace");
 if (!/SELECT current_schema\(\) AS schema/.test(queue) || !/createHash\("sha256"\)\.update\(schema\)/.test(queue) || !/schema === "public" \? "pgboss"/.test(queue)) throw new Error("Derive each queue namespace from its application schema, preserving public production queues");
 if ((queue.match(/await queueSchemaFor\(/g) ?? []).length !== 2) throw new Error("Resolve the same queue namespace for enqueue and scoped erasure");
 if (!fixture.includes("const queueSchema = await queueSchemaFor(f.store.pool);") || !fixture.includes("DROP SCHEMA IF EXISTS ${queueSchema} CASCADE") || fixture.includes("DROP SCHEMA IF EXISTS pgboss")) throw new Error("Fixtures must drop only their own derived queue schema");
}

export function checkWatchErasure(watches, queue, erasure) {
 const nodes = parsedNodes(watches);
 const remove = nodes.find(node => node.type === "FunctionDeclaration" && node.id?.name === "deleteWatches");
 const cancel = nodes.find(node => node.type === "FunctionDeclaration" && node.id?.name === "cancelWatch");
 for (const owner of [remove, cancel]) if (!astNodes(owner).some(node => node.type === "AwaitExpression" && node.argument?.callee?.name === "deleteScopedJobs")) throw new Error("Delete scoped queue jobs in every watch cancellation and erasure");
 const queueNodes = parsedNodes(queue);
 const scoped = queueNodes.find(node => node.type === "FunctionDeclaration" && node.id?.name === "deleteScopedJobs");
 const deletes = sqlOf(scoped).filter(item => /DELETE FROM/.test(item.text));
 if (deletes.length !== 1 || /\bname\b/.test(deletes[0].text) || !/data @> \$1::jsonb/.test(deletes[0].text)) throw new Error("Queue erasure must delete scoped jobs in every queue name and state, including legacy dead-letter rows");
 if (!astNodes(scoped).some(node => node.type === "ThrowStatement")) throw new Error("Queue erasure must prove zero survivors across all job states");
 if (/deadLetter/.test(queue)) throw new Error("Keep dead-letter routing disabled for account-scoped watch jobs");
 if (!erasure.includes("watchMail: { mayStillArrive: watches.mayStillArrive")) throw new Error("Report unresolved watch submission markers in the erasure receipt");
}

export function checkPublicFetch(source) {
 if (/addSubnet\("::ffff:/.test(source)) throw new Error("Do not block IPv4-mapped IPv6 with a BlockList subnet; check the embedded IPv4 explicitly");
 const nodes = parsedNodes(source);
 const fetch = nodes.find(node => node.type === "FunctionDeclaration" && node.id?.name === "fetchPublic");
 const hostCheck = astNodes(fetch).find(node => node.type === "CallExpression" && member(node.callee, "hosts", "has"));
 const loop = astNodes(fetch).find(node => node.type === "ForStatement");
 if (!hostCheck || !loop || hostCheck.start < loop.start || hostCheck.end > loop.end) throw new Error("Check the public host allowlist on every redirect hop");
 const get = nodes.find(node => node.type === "FunctionDeclaration" && node.id?.name === "get");
 if (!astNodes(get).some(node => node.type === "ObjectProperty" && node.key?.name === "lookup" && node.value?.name === "pin")) throw new Error("Connect only to the validated pinned address");
 if (!astNodes(get).some(node => node.type === "ObjectProperty" && node.key?.name === "rejectUnauthorized" && node.value?.value === true)) throw new Error("Verify seller TLS hostnames");
}

export function checkWatchResponses(delivery, issuer) {
 const accepted = parsedNodes(delivery).find(node => node.type === "VariableDeclarator" && node.id?.name === "accepted");
 if (!astNodes(accepted?.init).some(node => node.type === "CallExpression" && member(node.callee, "z", "strictObject"))) throw new Error("Parse the Resend accepted response with a strict object schema");
 const route = parsedNodes(issuer).find(node => node.type === "IfStatement" && astNodes(node.test).some(part => part.type === "StringLiteral" && part.value === "/account/watch"));
 const headers = astNodes(route?.consequent).filter(node => node.type === "CallExpression" && node.callee?.name === "pageHead");
 const declared = name => parsedNodes(issuer).find(node => node.type === "VariableDeclarator" && node.id?.name === name)?.init;
 const object = argument => argument?.type === "Identifier" ? declared(argument.name) : argument;
 if (!headers.length || headers.some(call => !astNodes(object(call.arguments[2])).some(node => node.type === "ObjectProperty" && node.key?.value === "cache-control" && node.value?.value === "no-store"))) throw new Error("Serve the watch activation response with cache-control no-store");
}

export function checkWatchVerification(skill, index, runner) {
 if (!skill.split("---")[1]?.includes("P08") || !skill.split("## Completion")[0].includes("features/watches.md") || !index.includes("[price watches](watches.md)") || !runner.includes('process.argv[2] === "p08"')) throw new Error("Route P08 watch changes to features/watches.md and the runnable p08 branch");
}

if (process.argv[1]?.endsWith("check-structure.mjs")) {
 checkCardOutputContract(fs.readFileSync("src/mcp/authenticated.ts", "utf8"), fs.readFileSync("src/card/adapter.ts", "utf8"), fs.readFileSync("src/card/contracts.ts", "utf8"), fs.readFileSync("src/server.ts", "utf8"));
 checkMemoryContract(fs.readFileSync("src/memory/index.ts", "utf8"), fs.readFileSync("src/mcp/authenticated.ts", "utf8"));
 checkWatchSender(fs.readFileSync("src/memory/watches.ts", "utf8"));
 checkWatchQueueIsolation(fs.readFileSync("src/queue/index.ts", "utf8"), fs.readFileSync("scripts/watch-fixture.mjs", "utf8"), ["scripts/watch-lanes.mjs", "scripts/perf-watch.mjs", "scripts/perf-story.mjs", "test/watch-corrections.test.mjs", "test/watch-races.test.ts"].map(file => fs.readFileSync(file, "utf8")));
 checkWatchErasure(fs.readFileSync("src/memory/watches.ts", "utf8"), fs.readFileSync("src/queue/index.ts", "utf8"), fs.readFileSync("src/accounts/erasure.ts", "utf8"));
 checkWatchLockOrder(fs.readFileSync("src/memory/watches.ts", "utf8"));
 checkWatchRecipient(fs.readFileSync("src/memory/watches.ts", "utf8"));
 checkWatchEntry(fs.readFileSync("src/controls/codec.ts", "utf8"), fs.readFileSync("src/mcp/outputs.ts", "utf8"), fs.readFileSync("src/mcp/authenticated.ts", "utf8"), fs.readFileSync("src/card/renderer.tsx", "utf8"));
 checkWatchActivation(fs.readFileSync("src/memory/watches.ts", "utf8"), fs.readFileSync("src/auth/issuer.ts", "utf8"), fs.readFileSync("src/server.ts", "utf8"));
 checkWatchBoundary(fs.readFileSync("src/auth/issuer.ts", "utf8"), fs.readFileSync("src/memory/watches.ts", "utf8"), fs.readFileSync("src/memory/index.ts", "utf8"));
 checkWatchWorker(fs.readFileSync("src/worker.ts", "utf8"), fs.readFileSync("src/delivery/index.ts", "utf8"));
 checkPublicFetch(fs.readFileSync("src/delivery/fetch.ts", "utf8"));
 checkWatchResponses(fs.readFileSync("src/delivery/index.ts", "utf8"), fs.readFileSync("src/auth/issuer.ts", "utf8"));
 checkWatchVerification(fs.readFileSync(".agents/skills/verify-scoat/SKILL.md", "utf8"), fs.readFileSync(".agents/skills/verify-scoat/features/README.md", "utf8"), fs.readFileSync("scripts/verify.mjs", "utf8"));
}

export function checkOutputContract(entries, adapter, gate) {
 for (const [name, entry] of Object.entries(entries)) {
  if (entry.inputSchema) checkWire(entry.inputSchema);
  if (!entry.outputSchema && ["scoat_guide", "scoat_hunt", "scoat_memory", "scoat_card"].includes(name)) throw new Error("Declare the full success/error output contract");
  if (!entry.outputSchema) continue;
  const schema = entry.outputSchema;
  if (schema.type !== "object" || schema.$schema !== "http://json-schema.org/draft-07/schema#" || !schema.oneOf?.some(branch => branch.properties?.ok?.const === false)) throw new Error("Declare an object-root success/error union in the shared draft-7/2020-12 subset");
  checkWire(schema);
 }
 if (!adapter.includes("return conform(name, await invoke(call))") || !adapter.includes("return conform(name, refuseInput(name, error))")) throw new Error("Route every known tool result through conform");
 if (!gate.includes("output.safeParse(wire)") || !gate.includes("JSON.stringify(wire)") || !gate.includes("throw new ContractBreach()")) throw new Error("Validate and serialize every output at the gate");
}
export function checkToolDescriptors(entries, catalog, adapter) {
 if (!adapter.includes('io: "input"')) throw new Error("Emit input schemas in input mode");
 const expected = { scoat_guide: [true, false, true, false], scoat_hunt: [false, true, undefined, false], scoat_memory: [false, true, false, true], scoat_card: [false, true, false, false] };
 for (const [name, entry] of Object.entries(entries)) {
  const hints = expected[name], annotations = entry.annotations;
  if (!hints || ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"].some((key, index) => annotations?.[key] !== hints[index])) throw new Error("Publish honest whole-tool annotations");
  if (!entry.title || !entry.description || entry.execution) throw new Error("Publish titles and operation descriptions without Tasks");
  const input = catalog[name].input;
  if (!("options" in input)) continue;
  const operations = input.options.map(option => option.shape.op.value);
  if (operations.some(op => !new RegExp(`\\b${op}\\b`).test(entry.description))) throw new Error("Describe every operation from its input owner");
  if (input.options.some(option => "requestKey" in option.shape) && entry.annotations.readOnlyHint) throw new Error("Mixed write tools cannot claim read-only");
 }
}

export function checkMemoryContract(source, adapter) {
 for (const code of ["invalid-cursor", "missing-item", "key-reused", "session-mismatch", "expired"]) {
  if (!source.includes('new MemoryRefusal("' + code + '")')) throw new Error("Use typed Memory refusals for expected failures");
 }
 if (!source.includes('throw new Error("Saved item integrity failure")')) throw new Error("Keep corrupt saved items as server faults");
 if (!adapter.includes("if (!(error instanceof MemoryRefusal)) throw error")) throw new Error("Propagate unexpected Memory infrastructure failures");
 if (!adapter.includes("structuredContent: { ok: true, value }") || !adapter.includes('value.kind === "confirmation-required"') || !adapter.includes('value.kind === "unwatched"')) throw new Error("Envelope Memory results and distinguish proposals from immediate cancellation");
}

export function checkCardOutputContract(adapter, card, contract, server = fs.readFileSync("src/server.ts", "utf8")) {
 const capture = server.indexOf("invocationUnavailable = databaseUnavailable(error)");
 const handled = server.indexOf("await transport.handleRequest(request, { parsedBody: body })");
 const gate = server.indexOf("if (invocationUnavailable !== null)", handled);
 const translation = server.indexOf('return Response.json({ error: "service_unavailable" }, { status: 503 })', gate);
 if (capture < 0 || handled < capture || gate < handled || translation < gate || translation > server.indexOf("return response;", handled)) throw new Error("Translate typed invocation infrastructure failures after SDK handling to sanitized HTTP 503");
 if (!adapter.includes("if (!(error instanceof ReadGrantFailure)) throw error")) throw new Error("Propagate card lineage and infrastructure failures");
 if (!adapter.includes('value: { capability: "issued", expiresAt: capability.expiresAt.toISOString() }') || !adapter.includes('_meta: { "scoat/readCapability": capability }')) throw new Error("Keep capability grants private and declare only public expiry");
 const publicValue=adapter.match(/value: \{ capability: "issued"[^\n]+/g) ?? [];
 if (publicValue.some(value => /\bgrant\b/.test(value))) throw new Error("Never publish a card grant");
 if ([adapter,card].some(source => source.includes('"scoat/cardFailure"')) || !card.includes("cardOutput.safeParse(reply.structuredContent)")) throw new Error("Read card errors from the shared structured contract");
 if (!contract.includes('huntSnapshot as snapshotSchema } from "../mcp/outputs.js"')) throw new Error("Share the snapshot output owner with the card");
 if (adapter.includes("JSON.stringify(")) throw new Error("Serialize public results only at conform");
}
export function checkConnectionPolicy(issuer, registration, adapter, server, config = fs.readFileSync("src/auth/config.ts", "utf8")) {
  if (!parsedNodes(config).some(node => node.type === "VariableDeclarator" && node.id?.name === "connectionLifetimeSeconds" && node.init?.value === 2592000) || ![issuer, adapter].every(source => /import \{[^}]*connectionLifetimeSeconds[^}]*\} from "\.\/config\.js"/.test(source))) throw new Error("Share the 30-day refresh lifetime from auth/config.ts");
  const nodes = parsedNodes(issuer);
  const options = nodes.find(node => node.type === "NewExpression" && node.callee?.name === "Provider")?.arguments?.[1]?.properties ?? [];
  const ttl = options.find(node => node.key?.name === "ttl")?.value.properties ?? [];
  if (options.find(node => node.key?.name === "rotateRefreshToken")?.value.value !== true || ["RefreshToken", "Grant", "Session"].some(name => ttl.find(node => node.key?.name === name)?.value.name !== "connectionLifetimeSeconds")) throw new Error("Rotate refresh tokens with 30-day parent lifetimes");
  if (!registration.includes('grant_types: ["authorization_code", "refresh_token"]') || !issuer.includes('["openid", "offline_access"].includes(value)') || !issuer.includes('issueRefreshToken: async (_ctx, client) => client.grantTypeAllowed("refresh_token")') || !adapter.includes('["Grant", "Session", "RefreshToken"].includes(model) ? connectionLifetimeSeconds') || !server.includes('scope="scoat:read scoat:write offline_access"')) throw new Error("Ship refresh scopes, grants, persistence and bearer challenge together");
  for (const text of ['model === "RefreshToken" && typeof payload.rotations === "number" && payload.rotations > 0', "expires_at=now()+$3*interval '1 second'", "payload=jsonb_set(payload,'{exp}'", "WHERE expires_at>now() AND ((model='Grant' AND id=$1) OR (model='Session' AND payload->>'uid'=$2))", 'throw new InactiveArtifact("OAuth refresh parents unavailable")']) if (!adapter.includes(text)) throw new Error("Keep fenced sliding refresh parent renewal");
  for (const text of ['https://claude.ai/api/mcp/auth_callback', 'localhost|127', '"native"', 'scoat-host-client-v2', 'scoat-chatgpt-client-v1', 'timingSafeEqual']) if (!registration.includes(text)) throw new Error("Keep signed ChatGPT and Claude callback registration and v1 compatibility");
}
