import { parse } from "@babel/parser";

function nodesOf(root) {
 const result = [];
 const visit = node => {
  if (!node || typeof node !== "object") return;
  if (node.type) result.push(node);
  for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
 };
 visit(root);
 return result;
}
const parsed = source => nodesOf(parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] }));
const literals = nodes => nodes.flatMap(node => node.type === "StringLiteral" ? [node.value] : node.type === "TemplateElement" ? [node.value.raw] : []);
const dynamicImports = nodes => nodes.filter(node => node.type === "ImportExpression" || (node.type === "CallExpression" && node.callee.type === "Import")).map(node => node.source ?? node.arguments?.[0]);
const root = node => ["MemberExpression", "OptionalMemberExpression"].includes(node.type) ? root(node.object) : ["CallExpression", "OptionalCallExpression"].includes(node.type) ? root(node.callee) : node.type === "Identifier" ? node.name : null;
const calls = (nodes, name) => nodes.filter(node => node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === name);
const writes = /\b(INSERT\s+INTO|UPDATE\s+[\w."${}]+\s+SET|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|DROP\s+(TABLE|SCHEMA)|CREATE\s+(TABLE|SCHEMA))\b/i;
const storyImports = new Map([
 ["node:assert/strict", null], ["node:os", null], ["node:crypto", null], ["node:fs/promises", null], ["node:perf_hooks", null],
 ["@modelcontextprotocol/sdk/client/index.js", ["Client"]], ["@modelcontextprotocol/sdk/client/streamableHttp.js", ["StreamableHTTPClientTransport"]],
 ["./durable-database.mjs", ["withDatabase"]], ["./watch-fixture.mjs", ["watchFixture", "productUrl"]], ["./story-conditions.mjs", ["storyConditions"]], ["./memory-lanes.mjs", ["confirm"]],
]);
const fixtureSurface = new Set(["f", "login", "browser", "issuer", "queueSchema", "workerProcess", "close", "exitCode", "signalCode"]);

function checkEntry(entry) {
 const branch = parsed(entry).find(node => node.type === "IfStatement" && nodesOf(node.test).some(part => part.type === "StringLiteral" && part.value === "p09"));
 const targets = branch ? dynamicImports(nodesOf(branch.consequent)).map(source => source?.value) : [];
 if (!targets.includes("./perf-p09.mjs") || targets.some(target => target !== "./perf-p09.mjs")) throw new Error("perf -- p09 must run the end-to-end story metric through scripts/perf-p09.mjs, not only microbenchmarks");
}

function checkOrchestrator(p09) {
 const nodes = parsed(p09);
 const imported = nodes.filter(node => node.type === "ImportDeclaration" && node.source.value === "./perf-story.mjs").flatMap(node => node.specifiers.map(item => item.imported?.name));
 const measure = calls(nodes, "measureStory")[0], judge = calls(nodes, "judgeStory")[0];
 if (!["measureStory", "judgeStory"].every(name => imported.includes(name)) || !measure || !judge) throw new Error("perf-p09 must measure and judge the public story from scripts/perf-story.mjs");
 const lineage = dynamicImports(nodes).filter(source => source?.value === "./perf-lineage.mjs");
 if (lineage.some(source => source.start < measure.end)) throw new Error("The lineage microbenchmark runs only after the story metric and never replaces it");
 const gated = nodes.some(node => ["MemberExpression", "OptionalMemberExpression"].includes(node.type) && !node.computed && node.property.name === "pass" && root(node) === "verdict");
 const exit = nodes.some(node => node.type === "AssignmentExpression" && node.left.type === "MemberExpression" && node.left.property.name === "exitCode");
 if (!gated || !exit || !literals(nodes).includes("p09-perf.json")) throw new Error("perf-p09 must fail its exit code from the story verdict and write p09-perf.json");
}

function checkStory(story) {
 const nodes = parsed(story);
 for (const node of nodes.filter(item => item.type === "ImportDeclaration")) {
  if (!storyImports.has(node.source.value)) throw new Error(`Perf story imports only public clients and fixture entry points, not ${node.source.value}`);
  const allowed = storyImports.get(node.source.value);
  if (allowed && node.specifiers.some(item => !allowed.includes(item.imported?.name))) throw new Error(`Perf story may import only ${allowed.join(", ")} from ${node.source.value}`);
 }
 if (dynamicImports(nodes).length) throw new Error("Perf story uses no dynamic imports");
 for (const node of nodes.filter(item => ["MemberExpression", "OptionalMemberExpression"].includes(item.type) && !item.computed && root(item) === "fixture").sort((a, b) => a.property.start - b.property.start)) {
  if (!fixtureSurface.has(node.property.name)) throw new Error(`Perf story drives the hunt and watch through public clients; fixture.${node.property.name} bypasses them`);
 }
 if (nodes.some(node => node.type === "Identifier" && ["seedWatch", "signUnsubscribe"].includes(node.name))) throw new Error("Perf story drives the hunt and watch through public clients; seeded state bypasses them");
 if (literals(nodes).some(text => writes.test(text))) throw new Error("Perf story performs no direct database writes");
 for (const call of nodes.filter(node => node.type === "CallExpression" && node.callee.type === "MemberExpression" && node.callee.property.name === "read" && root(node.callee) === "conditions")) {
  const sql = call.arguments[0];
  const text = sql?.type === "StringLiteral" ? sql.value : sql?.type === "TemplateLiteral" ? sql.quasis.map(item => item.value.raw).join("?") : null;
  if (!text || !/^\s*SELECT\b/i.test(text)) throw new Error("Perf story proofs read with literal SELECT statements only");
 }
 const text = literals(nodes);
 if (!["scoat_hunt", "finish", "read", "/healthz", "/account/watch"].every(item => text.includes(item)) || !nodes.some(node => node.type === "NewExpression" && node.callee.name === "StreamableHTTPClientTransport")) throw new Error("Perf story must run the scripted hunt through an SDK MCP client, the watch form and health");
 const budget = nodes.find(node => node.type === "VariableDeclarator" && node.id.name === "storyBudget")?.init;
 const limit = name => budget?.properties?.find(item => item.key?.name === name)?.value;
 for (const name of ["huntMilliseconds", "eligibleToOutboxMilliseconds"]) if (limit(name)?.type !== "NumericLiteral" || limit(name).value > 5000) throw new Error(`storyBudget.${name} must be a literal at most 5000`);
 if (limit("acceptancesPerAlert")?.value !== 1) throw new Error("storyBudget.acceptancesPerAlert must be 1");
}

function checkLineage(lineage) {
 const text = literals(parsed(lineage));
 if (text.some(item => /pending/i.test(item) && /story/i.test(item)) || !text.some(item => /supplementary/i.test(item))) throw new Error("perf-lineage is a supplementary microbenchmark and must not defer or stand in for the P09 story metric");
}

export function checkPerfStory({ entry, p09, story, lineage }) {
 checkEntry(entry);
 checkOrchestrator(p09);
 checkStory(story);
 checkLineage(lineage);
}
