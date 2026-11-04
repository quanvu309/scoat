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
const textOf = node => node.type === "StringLiteral" ? node.value : node.type === "TemplateLiteral" ? node.quasis.map(part => part.value.raw).join("${}") : null;
const literals = nodes => nodes.map(node => ({ node, text: textOf(node) })).filter(item => item.text !== null);
const named = (nodes, name) => nodes.find(node => (node.type === "FunctionDeclaration" && node.id?.name === name) || (node.type === "ClassMethod" && node.key?.name === name));
const calls = (nodes, name) => nodes.filter(node => node.type === "CallExpression" && (node.callee?.name === name || node.callee?.property?.name === name));
const statementText = (source, node) => source.slice(node.start, node.end);
const lineageBind = "identity=scoat_lineage_identity(pg_current_xact_id()::text::numeric % 4294967296)";
const lineageMatch = "identity=scoat_lineage_identity(xmin::text::numeric)";
const lineageOwner = "src/db/lineage.ts";

function poolReceiver(node) {
 if (node?.type === "Identifier") return node.name === "pool";
 return node?.type === "MemberExpression" && !node.computed && node.property?.name === "pool";
}

export function checkLineageFence(files) {
 for (const { file, source } of files) {
  const nodes = parsed(source);
  for (const { text } of literals(nodes)) {
   if (/\bSAVEPOINT\b/i.test(text)) throw new Error(`${file}: lineage-bound transactions never use savepoints`);
   if (file !== lineageOwner && /^\s*(BEGIN|START\s+TRANSACTION)\b/i.test(text)) throw new Error(`${file}: open transactions only through the shared lineage begin`);
   if (file !== lineageOwner && /scoat_lineage/.test(text)) throw new Error(`${file}: keep lineage SQL in its owner`);
  }
  for (const call of calls(nodes, "query")) {
   if (!poolReceiver(call.callee?.object)) continue;
   const sql = call.arguments[0] ? textOf(call.arguments[0]) : null;
   if (sql === null || /\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/i.test(sql)) throw new Error(`${file}: run pool writes inside a fenced transaction`);
  }
 }
}

export function checkLineageBegin(lineage, transaction) {
 const nodes = parsed(lineage);
 const begin = named(nodes, "begin");
 const steps = begin?.body?.body ?? [];
 const [open, hold, read, refuse] = steps.map(step => statementText(lineage, step));
 if (open !== 'await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");' || hold !== 'await client.query("SELECT pg_advisory_xact_lock_shared(80109, hashtext(current_schema()))");' || read !== "const state = await inspect(client);" || !/^if \(state\.kind !== "admitted"\) throw new LineageRefused\(/.test(refuse ?? "") || steps.length !== 4) throw new Error("Begin READ COMMITTED, hold the schema-scoped shared lineage lock, then check admission in a separate statement");
 const exclusive = named(nodes, "exclusive");
 if (!literals(nodesOf(exclusive)).some(item => item.text === "SELECT pg_advisory_xact_lock(80109, hashtext(current_schema()))")) throw new Error("Seal and unseal take the schema-scoped exclusive lineage lock");
 const writes = literals(nodes).filter(item => /\b(UPDATE|INSERT INTO)\s+scoat_lineage\b/.test(item.text));
 if (!writes.length || writes.some(item => !item.text.includes(lineageBind) || !item.text.includes(lineageMatch))) throw new Error("Every lineage write rebinds the new row xmin and requires the current identity");
 for (const name of ["seal", "unseal"]) if (!calls(nodesOf(named(nodes, name)), "exclusive").length) throw new Error(`${name} must run under the exclusive lineage fence`);
 for (const write of writes) if (!["seal", "unseal"].some(name => { const owner = named(nodes, name); return owner && owner.start < write.node.start && owner.end > write.node.end; })) throw new Error("Lineage writes belong to fenced seal and unseal only");
 const reopen = writes.find(item => /SET state='admitted'/.test(item.text));
 if (!reopen || !/consumed_by IS NULL/.test(reopen.text)) throw new Error("Unseal only before the source is consumed");
 const retry = named(parsed(transaction), "retryTransaction");
 const tried = nodesOf(retry).find(node => node.type === "TryStatement");
 if (!tried || statementText(transaction, tried.block.body[0] ?? tried.block) !== "await begin(client);") throw new Error("retryTransaction opens through the lineage begin");
}

export function checkLineageIdentity(migration, lineage, schema, journal) {
 const identity = /CREATE OR REPLACE FUNCTION scoat_lineage_identity\(row_xmin numeric\)[\s\S]*?\$lineage\$([\s\S]*?)\$lineage\$/.exec(migration)?.[1] ?? "";
 for (const part of ["(pg_control_system()).system_identifier", "pg_walfile_name(pg_current_wal_lsn())", "FROM pg_database WHERE datname = current_database()", "'.scoat_lineage')::oid", "row_xmin)"]) if (!identity.includes(part)) throw new Error("Lineage identity binds system identifier, WAL timeline, database oid, table oid and row xmin");
 if (!/INSERT INTO scoat_lineage \(state, identity, schema_head\) SELECT 'admitted', scoat_lineage_identity\(pg_current_xact_id\(\)::text::numeric % 4294967296\), '0004_lineage' WHERE NOT EXISTS \(SELECT 1 FROM scoat_lineage\) AND scoat_lineage_pristine\(\);/.test(migration)) throw new Error("Genesis admits only a pristine installation and binds its new row xmin");
 if (/SAVEPOINT|EXCEPTION/i.test(migration)) throw new Error("Lineage installation never wraps writes in subtransactions");
 const nodes = parsed(lineage);
 const same = named(nodes, "sameIdentity");
 const compared = nodesOf(same).filter(node => node.type === "BinaryExpression" && node.operator === "===").map(node => node.left?.property?.name);
 for (const field of ["systemIdentifier", "timeline", "databaseOid", "tableOid", "rowXmin"]) if (!compared.includes(field)) throw new Error("Admission compares every identity component including row xmin");
 if (!literals(nodes).some(item => item.text.includes("scoat_lineage_identity(xmin::text::numeric) AS current"))) throw new Error("Admission recomputes identity from the stored row xmin");
 if (!/z\.tuple\(\[component, component, component, component, component\]\)/.test(lineage) || !/z\.strictObject\(\{\n state:/.test(lineage)) throw new Error("Strictly parse the stored and current lineage identity");
 if (!schema.includes('"0004_lineage"') || !JSON.parse(journal).entries.some(entry => entry.tag === "0004_lineage")) throw new Error("Install lineage through the journal and durableSchema");
}

export function checkRuntimeAdmission({ server, worker, queue, watches, lineage, index }) {
 const serverNodes = parsed(server);
 const create = named(serverNodes, "createHttpServer");
 const inner = nodesOf(create);
 const admitted = calls(inner, "admit")[0];
 const firstEffect = Math.min(...[...calls(inner, "begin"), ...calls(inner, "maintainAccounts"), ...inner.filter(node => node.type === "NewExpression" && node.callee?.name === "Watches")].map(node => node.start));
 if (!admitted || admitted.start > firstEffect) throw new Error("Server admission precedes startup DDL, maintenance and Watches");
 const gateCall = calls(inner, "lineageStatus").find(node => node.arguments[0] && statementText(server, node.arguments[0]) === "store.pool" && !inner.some(other => other.type === "IfStatement" && /req\.url === "\/healthz"/.test(statementText(server, other.test)) && other.start < node.start && other.end > node.end));
 const routes = [...calls(inner, "route"), ...calls(inner, "authenticate")];
 const refusal = inner.find(node => node.type === "IfStatement" && statementText(server, node.test) === 'lineage !== "admitted"' && /res\.writeHead\(503/.test(statementText(server, node.consequent)));
 if (!gateCall || !refusal || !routes.length || routes.some(route => route.start < refusal.end)) throw new Error("Each request reports 503 before auth routes and MCP while unadmitted or sealed");
 if (!server.includes('const ready = !!auth && lineage === "admitted";')) throw new Error("Health is ready only while admitted");
 const start = named(parsed(worker), "startWorker");
 const workerNodes = nodesOf(start);
 const workerAdmit = calls(workerNodes, "admit")[0];
 const open = workerNodes.find(node => node.type === "CallExpression" && node.callee?.object?.name === "WatchQueue" && node.callee?.property?.name === "open");
 if (!workerAdmit || !open || workerAdmit.start > open.start || open.arguments[0]?.name !== "admitted") throw new Error("Worker admission precedes queue open, migration and plan");
 if (!/if \(error instanceof LineageRefused\) options\.refused\(error\);/.test(worker) || !/process\.exit\(78\);/.test(worker) || !/refused: refuse/.test(worker)) throw new Error("Worker exits 78 on typed lineage refusal, including jobs");
 const queueOpen = named(parsed(queue), "open");
 const param = queueOpen?.params[0];
 const confirmCall = calls(nodesOf(queueOpen), "confirm")[0];
 const boss = nodesOf(queueOpen).find(node => node.type === "NewExpression" && node.callee?.name === "PgBoss");
 if (param?.name !== "admitted" || param.optional || param.typeAnnotation?.typeAnnotation?.typeName?.name !== "Admitted" || !confirmCall || !boss || confirmCall.start > boss.start) throw new Error("WatchQueue.open requires and confirms a bound admitted capability before pg-boss");
 const constructor = parsed(watches).find(node => node.type === "ClassMethod" && node.kind === "constructor" && node.params[0]?.typeAnnotation && /admitted: Admitted;/.test(statementText(watches, node.params[0])));
 if (!constructor || /\bpool: pg\.Pool/.test(statementText(watches, constructor.params[0])) || !/pool: admitted\.pool/.test(statementText(watches, constructor))) throw new Error("Watches derive their pool from a required admitted capability");
 const capability = parsed(lineage).find(node => node.type === "ClassDeclaration" && node.id?.name === "Admitted");
 const ctor = capability?.body.body.find(node => node.kind === "constructor");
 if (ctor?.accessibility !== "private" || !capability.body.body.some(node => node.type === "ClassPrivateProperty" && node.key.id?.name === "scope")) throw new Error("Admitted is nominal with a private constructor and private scope");
 if (/db\/lineage|db\/transaction/.test(index)) throw new Error("Keep lineage authority out of public barrels");
}
