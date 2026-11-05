import { parse } from "@babel/parser";
import { parse as yaml } from "yaml";

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
const writes = /\b(INSERT\s+INTO|UPDATE\s+[\w."]+\s+SET|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|DROP\s+(TABLE|SCHEMA)|CREATE\s+(TABLE|SCHEMA)|pg_terminate_backend|setval|nextval)\b/i;
const storyImports = new Map([
 ["node:assert/strict", null], ["node:crypto", null], ["node:path", null],
 ["@modelcontextprotocol/sdk/client/index.js", ["Client"]], ["@modelcontextprotocol/sdk/client/streamableHttp.js", ["StreamableHTTPClientTransport"]],
 ["./watch-fixture.mjs", ["productUrl"]], ["./card-fixture.mjs", ["serveCard"]],
]);
const authority = new Set(["seedWatch", "watches", "authenticate", "pool", "store", "query", "tool", "rpc", "browser", "setEmail", "setIdentity", "state", "producer", "startWorker", "killWorker", "hold", "signUnsubscribe", "eraseAccount", "ControlCodec", "admitted", "config", "controlConfig", "delivery"]);
const exempt = new Set(["read", "queue", "settle", "hits", "next", "deliveries", "requests"]);

export function checkAcceptanceAuthority({ story, conditions }) {
 const nodes = parsed(story);
 for (const node of nodes.filter(item => item.type === "ImportDeclaration")) {
  if (!storyImports.has(node.source.value)) throw new Error(`Acceptance story imports only public clients and fixture entry points, not ${node.source.value}`);
  const allowed = storyImports.get(node.source.value);
  if (allowed && node.specifiers.some(item => !allowed.includes(item.imported?.name))) throw new Error(`Acceptance story may import only ${allowed.join(", ")} from ${node.source.value}`);
 }
 if (nodes.some(node => node.type === "ImportExpression" || (node.type === "CallExpression" && node.callee.type === "Import"))) throw new Error("Acceptance story uses no dynamic imports");
 const root = node => node.type === "MemberExpression" || node.type === "OptionalMemberExpression" ? root(node.object) : node.type === "CallExpression" ? root(node.callee) : node.name;
 for (const node of nodes) {
  if (node.type === "MemberExpression" && root(node) === "conditions") continue;
  const name = node.type === "MemberExpression" && !node.computed ? node.property.name : node.type === "Identifier" && authority.has(node.name) && ["seedWatch", "signUnsubscribe", "eraseAccount", "ControlCodec"].includes(node.name) ? node.name : null;
  if (name && authority.has(name)) throw new Error(`Acceptance story drives user state through public clients; ${name} bypasses them`);
 }
 if (literals(nodes).some(text => writes.test(text))) throw new Error("Acceptance story performs no direct database writes");
 const reads = nodes.filter(node => node.type === "CallExpression" && node.callee.type === "MemberExpression" && node.callee.property.name === "read" && node.callee.object.name === "conditions");
 for (const call of reads) {
  const sql = call.arguments[0];
  const text = sql?.type === "StringLiteral" ? sql.value : sql?.type === "TemplateLiteral" ? sql.quasis.map(item => item.value.raw).join("?") : null;
  if (!text || !/^\s*SELECT\b/i.test(text)) throw new Error("Acceptance proofs read with literal SELECT statements only");
 }
 const conditionNodes = parsed(conditions);
 if (!literals(conditionNodes).includes("BEGIN READ ONLY")) throw new Error("Story proofs run inside a READ ONLY transaction");
 if (literals(conditionNodes).some(text => writes.test(text))) throw new Error("Synthetic conditions perform no direct database writes");
 for (const method of conditionNodes.filter(node => node.type === "ObjectMethod" && !exempt.has(node.key.name))) {
  const recorded = nodesOf(method.body).some(node => node.type === "CallExpression" && node.callee.name === "record");
  if (!recorded) throw new Error(`Synthetic condition ${method.key.name} must be recorded as a labeled boundary`);
 }
}

export function checkFixtureWorker(source) {
 const nodes = parsed(source);
 const verify = nodes.find(node => node.type === "AwaitExpression" && node.argument?.callee?.name === "verifyRelease");
 const start = nodes.find(node => node.type === "CallExpression" && node.callee.name === "startWorker");
 const ready = nodes.find(node => ["CallExpression", "OptionalCallExpression"].includes(node.type) && node.callee.property?.name === "send" && node.arguments[0]?.properties?.some(item => item.key?.name === "artifact"));
 if (!verify || !start || !ready || verify.start > start.start || ready.start < start.end) throw new Error("Fixture worker verifies the shipped release and announces its digest only after startWorker");
}

export function checkAcceptanceLinkCapture(source) {
 const nodes = parsed(source);
 const capture = nodes.find(node => node.type === "FunctionDeclaration" && node.id?.name === "openCardLink");
 const body = capture && source.slice(capture.start, capture.end);
 const required = [
  "const before = await page.evaluate(() => window.harness.opened.length)",
  "await button.click()",
  "await page.waitForFunction(count => window.harness.opened.length > count, before)",
  "return page.evaluate(count => window.harness.opened[count], before)",
 ];
 const positions = required.map(text => body?.indexOf(text) ?? -1);
 const calls = nodes.filter(node => node.type === "CallExpression" && node.callee.name === "openCardLink");
 if (positions.some((position, index) => position < 0 || (index > 0 && position <= positions[index - 1])) || calls.length !== 3 || nodes.some(node => node.type === "CallExpression" && node.callee.name === "opened")) throw new Error("Await the new card host link after each click with openCardLink before navigating");
}

export function checkAcceptanceVerification(skill, index, runner, workflow) {
 const selector = skill.split("## Completion")[0];
 const runs = Object.values(yaml(workflow).jobs).flatMap(job => (job.steps ?? []).map(step => step.run ?? "")).flatMap(run => run.split("\n").map(line => line.trim()));
 if (!skill.split("---")[1]?.includes("P09 S4") || !selector.includes("features/acceptance.md") || !index.includes("[acceptance](acceptance.md)") || !runner.includes('process.argv[2] === "p09"') || !runs.includes("npm run verify -- p09")) throw new Error("Route P09 S4 acceptance through the skill header, selector, feature index, runnable verify p09 branch and hosted CI");
}
