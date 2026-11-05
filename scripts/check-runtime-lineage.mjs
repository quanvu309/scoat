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
const textOf = (source, node) => source.slice(node.start, node.end);
const literal = node => node?.type === "StringLiteral" ? node.value : node?.type === "TemplateLiteral" ? node.quasis.map(part => part.value.raw).join("${}") : null;
const named = (nodes, name) => nodes.find(node => node.type === "FunctionDeclaration" && node.id?.name === name);
const calls = (nodes, name) => nodes.filter(node => node.type === "CallExpression" && (node.callee?.name === name || node.callee?.property?.name === name));
const queries = nodes => calls(nodes, "query").map(call => literal(call.arguments[0])).filter(text => text !== null);

export function checkFixtureJournal({ fixture, journal }) {
 const body = nodesOf(named(parsed(journal), "migrateFixtureDatabase"));
 const gate = calls(body, "migrateAdmitted")[0];
 if (!gate || gate.arguments[0]?.name !== "pool" || !calls(nodesOf(gate.arguments[1]), "applyPending").length || !calls(body, "releaseJournal").length || calls(body, "query").length) throw new Error("Fixture journals come from real migrations under the admission gate, never synthetic journal rows");
 const fixtureNodes = parsed(fixture);
 const initialize = calls(fixtureNodes, "migrateFixtureDatabase")[0];
 const schema = calls(fixtureNodes, "query").find(call => nodesOf(call.arguments[0]).some(node => /CREATE SCHEMA/.test(literal(node) ?? "")));
 if (!initialize || initialize.arguments[0]?.name !== "admin" || !schema || initialize.end > schema.start) throw new Error("Migrate the base database before creating the private fixture schema");
}

export function checkMigrationAdmission({ database, lineage, journal }) {
 const databaseNodes = parsed(database);
 if (databaseNodes.some(node => node.type === "ImportDeclaration" && /drizzle-orm/.test(node.source.value)) || /pg_advisory_lock\(/.test(database)) throw new Error("Migrate applies the release journal only through the lineage-owned admission gate");
 const verified = calls(databaseNodes, "verifyRelease")[0];
 const gate = calls(databaseNodes, "migrateAdmitted")[0];
 const applier = gate?.arguments[1];
 if (!verified || !gate || gate.start < verified.end || gate.arguments[0]?.name !== "pool" || !["ArrowFunctionExpression", "FunctionExpression"].includes(applier?.type) || !calls(nodesOf(applier), "applyPending").length || calls(databaseNodes, "applyPending").length !== 1) throw new Error("Migrate verifies the release, then applies pending migrations only inside migrateAdmitted");
 const refusal = databaseNodes.find(node => node.type === "CatchClause" && node.start > gate.start && /instanceof LineageRefused/.test(textOf(database, node.body)) && /instanceof JournalRefused/.test(textOf(database, node.body)) && /process\.exitCode = 78/.test(textOf(database, node.body)));
 if (!refusal) throw new Error("Migrate exits 78 on typed lineage and journal refusals");
 const firstBegin = calls(databaseNodes, "begin")[0];
 const writes = calls(databaseNodes, "query").filter(call => /\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/i.test(literal(call.arguments[0]) ?? "INSERT"));
 if (writes.some(call => !firstBegin || call.start < firstBegin.end)) throw new Error("Operator writes run inside the shared lineage begin");
 const lineageNodes = parsed(lineage);
 const gateBody = nodesOf(named(lineageNodes, "migrateAdmitted"));
 const fence = calls(gateBody, "exclusive")[0];
 const run = calls(gateBody, "run")[0];
 const checks = calls(gateBody, "requireAdmitted");
 const presence = queries(gateBody);
 const guarded = gateBody.find(node => node.type === "IfStatement" && node.test?.name === "present" && calls(nodesOf(node.consequent), "requireAdmitted").length);
 if (!fence || !run || checks.length !== 2 || !guarded || guarded.end > run.start || checks[1].start < run.end || presence.length !== 1 || !/to_regclass\(/.test(presence[0]) || /FROM scoat_lineage/.test(presence[0])) throw new Error("Under the exclusive lineage lock, check catalog presence, require admission before DDL when lineage exists, and require an admitted result before commit");
 const required = nodesOf(named(lineageNodes, "requireAdmitted"));
 if (!calls(required, "inspect").length || !required.some(node => node.type === "NewExpression" && node.callee?.name === "LineageRefused")) throw new Error("Admission before and after migration refuses with the typed lineage reason");
 const journalNodes = parsed(journal);
 const apply = nodesOf(named(journalNodes, "applyPending"));
 const refuse = apply.find(node => node.type === "NewExpression" && node.callee?.name === "JournalRefused");
 const loop = apply.find(node => node.type === "ForOfStatement");
 if (!refuse || !loop || refuse.start > loop.start || !calls(apply, "classify").length) throw new Error("Refuse an installed journal ahead of or different from the release before applying statements");
}

export function checkJournalReadiness({ readiness, lineage, journal }) {
 const readinessNodes = parsed(readiness);
 if (readinessNodes.some(node => node.type === "Identifier" && node.name === "lineageSchemaHead")) throw new Error("Readiness reports the installed migration journal, never the lineage schema head");
 const observed = calls(readinessNodes, "observe")[0];
 if (!observed || observed.arguments.length !== 2 || !calls(readinessNodes, "releaseJournal").length || !/schemaStatus = installed === null \? "unknown" : installed\.status/.test(readiness)) throw new Error("Readiness compares the installed journal with the shipped release journal");
 const observeNodes = nodesOf(named(parsed(lineage), "observe"));
 if (!calls(observeNodes, "installedJournal").length || queries(observeNodes).some(text => /schema_head/.test(text))) throw new Error("Observation reads the installed journal through its owner");
 const rows = nodesOf(named(parsed(journal), "installedRows"));
 const reads = queries(rows);
 if (reads.length !== 2 || !/to_regclass\('drizzle\.__drizzle_migrations'\)/.test(reads[0]) || !/FROM drizzle\.__drizzle_migrations/.test(reads[1])) throw new Error("Check journal presence in the catalog before reading its rows");
}

export function checkRequestLineage(server) {
 const nodes = parsed(server);
 const refuse = named(nodes, "refuseLineage");
 if (!refuse || !/res\.writeHead\(503/.test(textOf(server, refuse))) throw new Error("A typed lineage refusal during a request reports 503");
 const create = nodesOf(named(nodes, "createHttpServer"));
 for (const name of ["route", "authenticate", "handleRequest"]) {
  const call = calls(create, name)[0];
  const inner = call ? create.filter(node => node.type === "TryStatement" && node.block.start <= call.start && node.block.end >= call.end).sort((left, right) => right.start - left.start)[0] : undefined;
  const first = inner?.handler?.body.body[0];
  if (!inner?.handler?.param || first?.type !== "IfStatement" || textOf(server, first.test) !== "error instanceof LineageRefused" || !calls(nodesOf(first.consequent), "refuseLineage").length) throw new Error("Map a typed lineage refusal to 503 before any generic 400, 401 or 503 response: " + name);
 }
 const call = calls(create, "invoke")[0];
 const inner = call ? create.filter(node => node.type === "TryStatement" && node.block.start <= call.start && node.block.end >= call.end).sort((left, right) => right.start - left.start)[0] : undefined;
 const first = inner?.handler?.body.body[0];
 if (first?.type !== "IfStatement" || textOf(server, first.test) !== "error instanceof LineageRefused" || textOf(server, first.consequent) !== "invocationRefusal = error.reason;" || calls(nodesOf(inner?.handler), "refuseLineage").length) throw new Error("Capture the invoke lineage refusal without writing a response before the SDK finishes: invoke");
 const adapter = calls(create, "getRequestListener")[0];
 const body = adapter?.arguments[0]?.body?.body;
 const response = body?.[0];
 const refusal = body?.[1];
 const fallback = body?.at(-1);
 if (response?.type !== "VariableDeclaration" || !calls(nodesOf(response), "handleRequest").length || refusal?.type !== "IfStatement" || textOf(server, refusal.test) !== "invocationRefusal !== undefined" || !/return Response\.json\(\{ error: "service_unavailable", lineage: invocationRefusal \}, \{ status: 503 \}\)/.test(textOf(server, refusal.consequent)) || fallback?.type !== "ReturnStatement" || fallback.argument?.name !== "response") throw new Error("Translate the invoke refusal to one HTTP 503 after the SDK response resolves; preserve other SDK responses");

}
