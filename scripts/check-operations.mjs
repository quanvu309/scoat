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
const textOf = (source, node) => source.slice(node.start, node.end);
const named = (nodes, name) => nodes.find(node => node.type === "FunctionDeclaration" && node.id?.name === name);
const calls = (nodes, name) => nodes.filter(node => node.type === "CallExpression" && (node.callee?.name === name || node.callee?.property?.name === name));
const member = (node, object, property) => node?.type === "MemberExpression" && node.object?.name === object && node.property?.name === property;
const exits78 = (nodes) => calls(nodes, "exit").some(call => member(call.callee, "process", "exit") && call.arguments[0]?.value === 78);
const mainBlock = (source, nodes) => nodes.find(node => node.type === "IfStatement" && textOf(source, node.test).includes("import.meta.url === pathToFileURL(process.argv[1]).href"));

export function checkReadiness({ server, worker, readiness, database }) {
 const serverNodes = parsed(server);
 if (serverNodes.some(node => node.type === "ObjectProperty" && (node.key?.name === "phase" || node.key?.value === "phase"))) throw new Error("Health reports current readiness, never a fixed phase label");
 const create = named(serverNodes, "createHttpServer");
 const first = create?.body.body[0]?.declarations?.[0];
 if (first?.id?.name !== "release" || first.init?.type !== "AwaitExpression" || first.init.argument?.callee?.name !== "verifyRelease" || first.init.argument.arguments.length !== 0) throw new Error("Verify the shipped release before any database or listener work");
 const inner = nodesOf(create);
 const admission = inner.find(node => node.type === "IfStatement" && calls(nodesOf(node.consequent), "admit").length);
 if (!admission || !/release\.kind === "verified"/.test(textOf(server, admission.test))) throw new Error("Admit, install and maintain only for a verified release");
 const healthBranch = inner.find(node => node.type === "IfStatement" && /req\.url === "\/healthz"/.test(textOf(server, node.test)));
 const healthNodes = healthBranch ? nodesOf(healthBranch.consequent) : [];
 const report = healthNodes.find(node => node.type === "VariableDeclarator" && node.init?.type === "AwaitExpression" && node.init.argument?.callee?.name === "health");
 const args = report?.init.argument.arguments ?? [];
 const status = calls(healthNodes, "writeHead")[0]?.arguments[0];
 if (!report || args.length !== 4 || args[0]?.name !== "release" || status?.type !== "ConditionalExpression" || !member(status.test, report.id.name, "ready") || status.consequent?.value !== 200 || status.alternate?.value !== 503) throw new Error("Health status derives only from the shared readiness report over the verified release");
 if (inner.some(node => node.type === "VariableDeclarator" && node.id?.name === "ready")) throw new Error("Do not compute a second readiness outside the readiness owner");
 const gate = inner.find(node => node.type === "IfStatement" && textOf(server, node.test) === 'release.kind !== "verified"' && /res\.writeHead\(503/.test(textOf(server, node.consequent)) && node.consequent.body?.at(-1)?.type === "ReturnStatement");
 const routes = [...calls(inner, "route"), ...calls(inner, "authenticate")];
 if (!gate || !routes.length || routes.some(route => route.start < gate.end) || gate.start < healthBranch.end) throw new Error("Refuse every non-health request with 503 while the release is unverified");
 const readinessNodes = parsed(readiness);
 if (!readinessNodes.some(node => node.type === "ObjectProperty" && node.key?.name === "ready" && textOf(readiness, node.value) === "reasons.length === 0")) throw new Error("Ready is exactly the absence of refusal reasons");
 const reasons = readinessNodes.find(node => node.type === "VariableDeclarator" && node.id?.name === "reasons");
 const reasonText = reasons ? textOf(readiness, reasons.init) : "";
 for (const input of ["release.kind", "database", "schemaStatus", "lineage", "authConfigured", "encrypted"]) if (!reasonText.includes(input)) throw new Error("Readiness reasons cover artifact, database, schema, lineage, auth and transport: missing " + input);
 if (calls(readinessNodes, "query").length || !calls(readinessNodes, "observe").length) throw new Error("Readiness reads lineage and schema only through the lineage owner");
 const workerNodes = parsed(worker);
 const main = mainBlock(worker, workerNodes);
 const body = main?.consequent.body ?? [];
 const verified = body[0]?.declarations?.[0];
 const refusal = body[1];
 if (verified?.init?.argument?.callee?.name !== "verifyRelease" || refusal?.type !== "IfStatement" || !exits78(nodesOf(refusal.consequent))) throw new Error("Worker verifies the release first and exits 78 on refusal");
 const mainNodes = nodesOf(main);
 const started = calls(mainNodes, "startWorker")[0];
 const announcements = calls(mainNodes, "send").filter(call => member(call.callee, "process", "send"));
 if (!started || !announcements.length || announcements.some(call => call.start < started.end || !nodesOf(call.arguments[0]).some(node => node.type === "ObjectProperty" && node.key?.name === "artifact"))) throw new Error("Worker announces ready with the release digest only after admission and queue setup");
 const databaseNodes = parsed(database);
 const check = calls(databaseNodes, "verifyRelease")[0];
 const pool = databaseNodes.find(node => node.type === "NewExpression" && member(node.callee, "pg", "Pool"));
 if (!check || !pool || check.start > pool.start || !exits78(databaseNodes)) throw new Error("Migrate verifies the release and exits 78 before connecting");
}

export function checkReleaseOwner({ release, build, sources }) {
 const nodes = parsed(release);
 const filter = calls(nodes, "filter").find(call => /name !== releaseManifest/.test(textOf(release, call)));
 if (!filter) throw new Error("Exclude the release manifest from its own digest");
 if (!/const manifestSchema = z\.strictObject\(/.test(release)) throw new Error("Parse release metadata strictly");
 for (const reason of ["artifact-metadata-absent", "artifact-metadata-malformed", "artifact-inputs-changed"]) if (!nodes.some(node => node.type === "ReturnStatement" && node.argument && textOf(release, node.argument).includes(`reason: "${reason}"`))) throw new Error("Refuse release verification as " + reason);
 const owner = nodes.find(node => node.type === "ClassDeclaration" && node.id?.name === "Release");
 if (owner?.body.body.find(node => node.kind === "constructor")?.accessibility !== "private") throw new Error("Release is nominal with a private constructor");
 if (!/import\("\.\.\/dist\/release\.js"\)/.test(build) || !/recordRelease\(\)/.test(build) || /createHash/.test(build)) throw new Error("Build records the release through the shared owner only");
 for (const { file, source } of sources) {
  if (file === "src/release.ts") continue;
  if (/release\.json/.test(source)) throw new Error(`${file}: only the release owner reads or writes release metadata`);
  if (["src/server.ts", "src/worker.ts", "src/readiness.ts"].includes(file) && /from "node:crypto"/.test(source)) throw new Error(`${file}: server and worker never hash release inputs themselves`);
 }
}

export function checkPoolOwner(sources) {
 for (const { file, source } of sources) {
  const nodes = parsed(source);
  const constructed = nodes.filter(node => node.type === "NewExpression" && (member(node.callee, "pg", "Pool") || node.callee?.name === "Pool"));
  if (file === "src/db/pool.ts") {
   if (constructed.length !== 1 || !calls(nodes, "on").some(call => call.arguments[0]?.value === "error")) throw new Error("The pool owner handles idle connection errors");
  } else if (constructed.length) throw new Error(`${file}: open database pools only through openPool`);
 }
}

export function checkListenHost(server) {
 const nodes = parsed(server);
 const schema = nodes.find(node => node.type === "VariableDeclarator" && node.id?.name === "listenHostSchema");
 if (!schema || textOf(server, schema.init) !== "z.union([z.ipv4(), z.ipv6()])") throw new Error("SCOAT_LISTEN_HOST accepts only strict IPv4 or IPv6 literals");
 const parser = nodes.find(node => node.type === "FunctionDeclaration" && node.id?.name === "listenHost");
 if (!parser || !/value \?\? "127\.0\.0\.1"/.test(textOf(server, parser))) throw new Error("SCOAT_LISTEN_HOST defaults to 127.0.0.1");
 const host = nodes.find(node => node.type === "VariableDeclarator" && node.id?.name === "host" && node.init?.callee?.name === "listenHost" && node.init.arguments.length === 1 && textOf(server, node.init.arguments[0]) === "process.env.SCOAT_LISTEN_HOST");
 const refusal = nodes.find(node => node.type === "IfStatement" && textOf(server, node.test) === "host === null");
 const listens = calls(nodes, "listen");
 if (!host || !refusal || !exits78(nodesOf(refusal.consequent)) || !listens.length || listens.some(call => call.arguments[1]?.name !== "host")) throw new Error("Bind only the parsed SCOAT_LISTEN_HOST and exit 78 on a non-literal");
}

export function checkHostedCoverage(source) {
 const workflow = yaml(source);
 const jobs = Object.values(workflow.jobs);
 const runs = jobs.flatMap(job => (job.steps ?? []).map(step => step.run ?? ""));
 for (const job of jobs) {
  if (!Number.isInteger(job["timeout-minutes"]) || job["timeout-minutes"] > 60) throw new Error("Bound every hosted job with timeout-minutes of at most 60");
  if (job.services?.postgres && job.services.postgres.image !== "postgres:17.6-alpine") throw new Error("Keep the PostgreSQL 17.6 fixture server");
 }
 if (/\/home\/|SCOAT_BASE_APP|p09\/s0/.test(source)) throw new Error("Hosted CI never depends on developer homes, S0 installs or a prebuilt base artifact");
 const required = ["p01", "p02", "p03", "p04", "p05", "p06", "p07-controls", "p07-card", "p08", "p09-lineage", "p09-recovery", "p09-operations", "p09"].map(scope => "npm run verify -- " + scope);
 for (const command of [...required, "npm run perf -- p09"]) if (!runs.some(run => run.split("\n").map(line => line.trim()).includes(command))) throw new Error("Hosted CI runs " + command);
 const install = runs.findIndex(run => /apt\.postgresql\.org/.test(run) && /postgresql-client-18/.test(run));
 const recovery = runs.findIndex(run => /verify -- p09-(lineage|recovery)/.test(run));
 if (install < 0 || install > recovery) throw new Error("Install official PGDG PostgreSQL 18 client tools before the recovery lanes");
 if (!jobs.some(job => job.env?.SCOAT_PG_BIN === "/usr/lib/postgresql/18/bin")) throw new Error("Point SCOAT_PG_BIN at the installed PGDG client tools");
 const browsers = runs.findIndex(run => /playwright install --with-deps chromium/.test(run));
 const firstBrowser = runs.findIndex(run => /verify -- p0[67]/.test(run));
 if (browsers < 0 || browsers > firstBrowser) throw new Error("Install Chromium with its system dependencies before browser lanes");
}

export function checkLaneTools(lanes) {
 for (const { file, source } of lanes) {
  if (/\.local\/pg|p09\/s0|SCOAT_PG_BIN \?\?|SCOAT_PG_LIB \?\?|SCOAT_BASE_APP \?\?/.test(source)) throw new Error(`${file}: resolve lane tools from explicit environment or task scratch, never developer installs`);
 }
 const recovery = lanes.find(item => item.file === "scripts/verify-recovery.mjs")?.source ?? "";
 if (!/baseArtifact\(checkout, root, "6ec8b75"\)/.test(recovery)) throw new Error("Build the labeled 6ec8b75 base artifact inside task scratch");
}

const required = ["DATABASE_URL", "PORT", "SCOAT_LISTEN_HOST", "SCOAT_AUTH_CONFIG", "SCOAT_CONTROL_CONFIG", "SCOAT_WATCH_CONFIG", "SCOAT_TLS_KEY", "SCOAT_TLS_CERT", "SCOAT_PG_BIN"];

function unit(text) {
 const entries = {};
 for (const line of text.split("\n")) {
  const match = /^([A-Za-z]+)=(.*)$/.exec(line);
  if (match) (entries[match[1]] ??= []).push(match[2]);
 }
 return entries;
}

export function checkDeployUnits({ migrate, server, worker, env }) {
 const units = { migrate: unit(migrate), server: unit(server), worker: unit(worker) };
 const directory = units.migrate.WorkingDirectory?.[0], file = units.migrate.EnvironmentFile?.[0];
 for (const [name, entries] of Object.entries(units)) {
  if (entries.WorkingDirectory?.join() !== directory || entries.EnvironmentFile?.join() !== file || !directory || !file) throw new Error(`scoat-${name}: share one release directory and one EnvironmentFile`);
  if (entries.ExecStart?.length !== 1 || !entries.ExecStart[0].startsWith("/usr/bin/node " + directory + "/")) throw new Error(`scoat-${name}: execute only from the shared release directory`);
 }
 if (units.migrate.Type?.[0] !== "oneshot" || !/scoat-server\.service/.test(units.migrate.Before?.join(" ") ?? "") || !/scoat-worker\.service/.test(units.migrate.Before?.join(" ") ?? "")) throw new Error("Migrate is a oneshot ordered before server and worker");
 for (const name of ["server", "worker"]) {
  const entries = units[name];
  if (!entries.Requires?.join(" ").includes("scoat-migrate.service") || !entries.After?.join(" ").includes("scoat-migrate.service")) throw new Error(`scoat-${name}: require and order after migrate`);
  if (entries.RestartPreventExitStatus?.join(" ") !== "78") throw new Error(`scoat-${name}: never restart a typed exit 78 refusal`);
 }
 const lines = env.split("\n").filter(line => line.trim());
 const names = lines.map(line => /^([A-Z_]+)=/.exec(line)?.[1]);
 if (names.some(name => !name) || names.join() !== required.join()) throw new Error("scoat.env.example lists exactly the required environment names");
 const values = Object.fromEntries(lines.map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
 const database = new URL(values.DATABASE_URL);
 if (database.password !== "REPLACE_WITH_PASSWORD" || !database.hostname.endsWith(".invalid")) throw new Error("scoat.env.example carries only placeholder credentials");
 if (!/^(\d{1,3}\.){3}\d{1,3}$|:/.test(values.SCOAT_LISTEN_HOST)) throw new Error("scoat.env.example listens on an IP literal");
}

export function checkOperationsVerification(skill, index, runner, perf) {
 const selector = skill.split("## Completion")[0];
 if (!skill.split("---")[1]?.includes("P09 S3") || !selector.includes("features/operations.md") || !index.includes("[operations](operations.md)") || !runner.includes('process.argv[2] === "p09-operations"') || !perf.includes('process.argv[2] === "p09"')) throw new Error("Route P09 operations and performance changes to features/operations.md and the runnable p09-operations and perf p09 branches");
}
