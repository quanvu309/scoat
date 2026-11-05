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
 const writers = ["seal", "unseal", "consumeSource", "bindTarget"];
 for (const name of [...writers, "migrateQuarantined"]) if (!calls(nodesOf(named(nodes, name)), "exclusive").length) throw new Error(`${name} must run under the exclusive lineage fence`);
 const ownerOf = write => writers.find(name => { const owner = named(nodes, name); return owner && owner.start < write.node.start && owner.end > write.node.end; });
 for (const write of writes) if (!ownerOf(write)) throw new Error("Lineage writes belong to fenced seal, unseal, consume and bind only");
 if (!writes.length || writes.some(item => !item.text.includes(lineageBind) || (ownerOf(item) !== "bindTarget" && !item.text.includes(lineageMatch)))) throw new Error("Every lineage write rebinds the new row xmin and requires the current identity");
 const reopen = writes.filter(item => /SET state='admitted'/.test(item.text) && ownerOf(item) !== "bindTarget");
 if (reopen.length !== 1 || !/consumed_by IS NULL/.test(reopen[0].text) || /OR consumed_by|consumed_by\s*=\s*\$/.test(reopen[0].text)) throw new Error("Unseal only before the source is consumed");
 const unsealer = named(nodes, "unseal");
 if (unsealer.params.length !== 2 || unsealer.params.map(param => param.name).join(",") !== "pool,sealId" || ["locateTarget", "confirmOrigin", "designated"].some(name => calls(nodesOf(unsealer), name).length)) throw new Error("Unseal takes no target and never reopens a consumed source from target state");
 const consume = writes.filter(item => ownerOf(item) === "consumeSource");
 if (consume.length !== 1 || !consume[0].text.includes("WHERE state='sealed' AND seal_id=$1 AND (consumed_by IS NULL OR consumed_by=$2) AND " + lineageMatch)) throw new Error("Consume the source once by sealed state, seal id, null-or-same target and current identity");
 const binder = named(nodes, "bindTarget");
 const bind = writes.filter(item => ownerOf(item) === "bindTarget");
 const recheck = calls(nodesOf(binder), "designated").find(call => statementText(lineage, call) === "designated(source, target, true)");
 if (bind.length !== 1 || !bind[0].text.includes("WHERE state='sealed' AND seal_id=$1 AND scoat_lineage_identity(xmin::text::numeric)=$2") || !recheck || recheck.start > bind[0].node.start) throw new Error("Bind the same quarantined target only after rechecking that the source designates it");
 const migrator = named(nodes, "migrateQuarantined");
 const quarantined = calls(nodesOf(migrator), "query").filter(call => /scoat_lineage_identity\(xmin::text::numeric\)=\$2 AND identity<>\$2/.test(statementText(lineage, call)) || call.arguments[0]?.name === "quarantined");
 const runCall = calls(nodesOf(migrator), "run")[0];
 if (!literals(nodesOf(migrator)).some(item => /state='sealed' AND seal_id=\$1 AND scoat_lineage_identity\(xmin::text::numeric\)=\$2 AND identity<>\$2/.test(item.text)) || !runCall || quarantined.length !== 2 || !(quarantined[0].start < runCall.start && runCall.end < quarantined[1].start)) throw new Error("Migrate only a quarantined copy and recheck it before and after the migration");
 const target = parsed(lineage).find(node => node.type === "ClassDeclaration" && node.id?.name === "QuarantinedTarget");
 const targetCtor = target?.body.body.find(node => node.kind === "constructor");
 if (targetCtor?.accessibility !== "private" || !["sealId", "locator"].every(name => target.body.body.some(node => node.type === "ClassPrivateProperty" && node.key.id?.name === name))) throw new Error("QuarantinedTarget is nominal with a private constructor and private locator");
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
 if (!/z\.tuple\(\[component, component, component, component, component\]\)/.test(lineage) || !/const rowSchema = z\.strictObject\(\{\n state:/.test(lineage) || !/const targetSchema = z\.strictObject\(\{\n state:/.test(lineage)) throw new Error("Strictly parse the stored and current lineage identity");
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

const callOrder = (nodes, names) => names.map(name => { const found = calls(nodes, name); return found.length === 1 ? found[0].start : -1; });
const ascending = positions => positions.every((value, index) => value >= 0 && (index === 0 || value > positions[index - 1]));

export function checkRecoveryAuthority({ handoff, recovery, tools, index }) {
 const handoffNodes = parsed(handoff);
 const admitter = nodesOf(named(handoffNodes, "admitTarget"));
 if (!ascending(callOrder(admitter, ["distinct", "locateTarget", "designated", "migrateQuarantined", "consumeSource", "bindTarget"])) || ["seal", "unseal", "inspect"].some(name => calls(admitter, name).length)) throw new Error("Admit checks the target and source, migrates atomically, consumes the source, then binds the target");
 const migration = calls(admitter, "migrateQuarantined")[0];
 if (!calls(nodesOf(migration), "applyPending").length || calls(handoffNodes, "applyPending").length !== 1) throw new Error("Apply target migrations only inside the quarantined migration transaction");
 const restorer = nodesOf(named(handoffNodes, "restore"));
 const tool = calls(restorer, "runTool");
 const dumpCall = tool.find(call => call.arguments[1]?.value === "dump"), restoreCall = tool.find(call => call.arguments[1]?.value === "restore");
 const checks = callOrder(restorer, ["distinct", "inspect", "fresh", "reserve"]);
 if (tool.length !== 2 || !dumpCall || !restoreCall || !ascending([...checks, dumpCall.start, restoreCall.start, callOrder(restorer, ["locateTarget"])[0]])) throw new Error("Refuse same, unsealed, consumed or populated targets before running pg_dump and pg_restore, then require the sealed archive");
 if (["admitTarget", "applyPending", "migrateQuarantined", "consumeSource", "bindTarget", "admit", "seal", "unseal"].some(name => calls(restorer, name).length)) throw new Error("A restored archive stays quarantined and never certifies itself");
 for (const node of handoffNodes.filter(node => node.type === "BinaryExpression" && node.operator === "+" && textOf(node.left) === "--dbname=")) if (node.right?.type !== "MemberExpression" || node.right.property?.name !== "dbname") throw new Error("Pass tools a libpq connection without its password");
 const toolNodes = parsed(tools);
 if (toolNodes.some(node => node.type === "ImportSpecifier" && ["exec", "execSync", "spawnSync", "spawn"].includes(node.imported?.name))) throw new Error("Spawn PostgreSQL tools with execFile argument arrays only");
 const runs = calls(toolNodes, "run");
 if (!runs.length || runs.some(call => !call.arguments[2]?.properties?.some(prop => prop.key?.name === "shell" && prop.value?.type === "BooleanLiteral" && prop.value.value === false))) throw new Error("Spawn PostgreSQL tools without a shell");
 if (!/parsed\.password = "";/.test(tools) || !/if \(password !== null\) environment\.PGPASSWORD = password;/.test(tools)) throw new Error("Keep passwords out of tool argv and in the child environment only");
 const parse = calls(parsed(recovery), "parseArgs")[0];
 const options = parse?.arguments[0]?.properties ?? [];
 if (!options.some(prop => prop.key?.name === "strict" && prop.value?.value === true) || /z\.object\(/.test(recovery) || (recovery.match(/z\.strictObject\(\{ command: z\.literal/g) ?? []).length !== 5) throw new Error("Parse recovery commands strictly");
 if (/recovery/.test(index)) throw new Error("Keep recovery authority out of public barrels");
}

export function checkRecoveryVerification(skill, index, runner) {
 const selector = skill.split("## Completion")[0];
 if (!skill.split("---")[1]?.includes("P09 S2") || !selector.includes("features/recovery.md") || !index.includes("[recovery](recovery.md)") || !runner.includes('process.argv[2] === "p09-recovery"')) throw new Error("Route P09 recovery changes to features/recovery.md and the runnable p09-recovery branch");
}

export function checkLineageVerification(skill, index, runner) {
 const selector = skill.split("## Completion")[0];
 const route = selector.split("\n").find(line => /^\d+\. For P09 lineage,/.test(line));
 if (!skill.split("---")[1]?.includes("P09 S1") || !route?.includes("[lineage](features/lineage.md)") || !index.includes("[lineage](lineage.md)") || !runner.includes('process.argv[2] === "p09-lineage"') || !runner.includes('import("./verify-lineage.mjs")')) throw new Error("Route P09 lineage changes to features/lineage.md and the runnable p09-lineage branch");
}

export function checkRecoveryDocumentation({ readme, index, recovery, operations, lineage }) {
 if (/story is not implemented yet|story and its independent reviews are still pending/.test(readme + index)) throw new Error("Document the implemented P09 linked story and keep external acceptance separate");
 for (const source of [recovery, operations, lineage]) if (!/cold physical clone/.test(source) || !/pg_basebackup/.test(source) || !/parallel/.test(source)) throw new Error("Document undetectable parallel cold physical clones and pg_basebackup copies as forbidden");
 if (/Stop nothing|every worker exits 78 at its next transaction/.test(recovery)) throw new Error("Stop workers before the sealed dump and distinguish feature fences from queue supervision");
 if (!operations.includes("## Release rollback")) throw new Error("Document release rollback against the installed migration head");
}
