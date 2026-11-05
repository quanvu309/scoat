import { isDeepStrictEqual } from "node:util";
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

const pgdgInstall = "sudo install -d /usr/share/postgresql-common/pgdg\nsudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc\necho \"deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main\" | sudo tee /etc/apt/sources.list.d/pgdg.list\nsudo apt-get update\nsudo apt-get install -y --no-install-recommends postgresql-client-18\n/usr/lib/postgresql/18/bin/pg_dump --version";
const aggregateCommand = "node -e 'const keys = [\"quality\", \"protocol\", \"browser\", \"operations\", \"watch-performance\"]; try { const needs = JSON.parse(process.env.NEEDS_JSON); if (needs === null || Array.isArray(needs) || typeof needs !== \"object\" || Object.keys(needs).length !== keys.length || !keys.every(key => Object.hasOwn(needs, key) && needs[key]?.result === \"success\")) process.exit(1); } catch { process.exit(1); }'";

const imageBuild = "docker build --build-arg RAILWAY_GIT_COMMIT_SHA=\"$(git rev-parse HEAD)\" --tag scoat-ci .";
const imageVerify = "docker run --rm --network none --entrypoint node scoat-ci --input-type=module -e 'const state = await (await import(\"./dist/release.js\")).verifyRelease(); if (state.kind !== \"verified\") process.exit(1); console.log(state.release.digest);'";
const imageStartup = "for role in server worker; do\n  status=0\n  output=$(timeout 30s docker run --rm --network none --env SCOAT_RUNTIME_ROLE=\"$role\" scoat-ci 2>&1) || status=$?\n  printf '%s\\n' \"$output\"\n  test \"$status\" -eq 78\n  printf '%s\\n' \"$output\" | grep -F runtime_configuration_refused\ndone";

const suiteCommands = {
 quality: ["npm run typecheck", "npm run lint", "npm test", imageBuild, imageVerify, imageStartup],
 protocol: ["npm run db:migrate", "npm run db:migrate", "npm run db:seed -- --fixture ci-p01", "npm run db:seed -- --fixture ci-p01", ...["p01", "p02", "p03", "p04", "p05"].flatMap(scope => ["npm run verify -- " + scope, "npm run perf -- " + scope])],
 browser: ["npm run verify -- auth-ui", "npm run verify -- p06", "npm run perf -- p06", "npm run verify -- p07-controls", "npm run verify -- p07-card", "npm run verify -- p08"],
 operations: ["npm run verify -- p09-lineage", "npm run verify -- p09-recovery", "npm run verify -- p09-operations", "npm run perf -- p09", "npm run verify -- p09"],
 "watch-performance": ["npm run perf -- p08"]
};
const chromiumInstall = "npx playwright install --with-deps chromium";
const systemdNode = 'sudo ln -sfn "$(command -v node)" /usr/bin/node';
const mediaInstall = "sudo apt-get install -y --no-install-recommends ffmpeg";
const same = isDeepStrictEqual;
const onlyKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));

export function checkHostedCoverage(source) {
 const workflow = yaml(source);
 const entries = Object.entries(workflow.jobs ?? {});
 const jobs = entries.map(([, job]) => job);
 const runs = jobs.flatMap(job => (job.steps ?? []).map(step => step.run ?? ""));
 for (const job of jobs) {
  if (job["runs-on"] !== "ubuntu-latest") throw new Error("Use GitHub-hosted standard ubuntu-latest only");
  if (!Number.isInteger(job["timeout-minutes"]) || job["timeout-minutes"] <= 0 || job["timeout-minutes"] > 60) throw new Error("Bound every hosted job with positive timeout-minutes of at most 60");
  if (job.services?.postgres && job.services.postgres.image !== "postgres:17.6-alpine") throw new Error("Keep the PostgreSQL 17.6 fixture server");
 }
 if (/\/home\/|SCOAT_BASE_APP|p09\/s0/.test(source)) throw new Error("Hosted CI never depends on developer homes, S0 installs or a prebuilt base artifact");
 const required = Object.values(suiteCommands).flat().filter(command => command.startsWith("npm run verify -- "));
 for (const command of [...required, "npm run perf -- p09"]) if (!runs.some(run => run.split("\n").map(line => line.trim()).includes(command))) throw new Error("Hosted CI runs " + command);
 for (const [id, job] of entries) {
  const before = (command, prerequisite, diagnostic) => {
   const consumer = job.steps.findIndex(step => step.run === command);
   if (consumer < 0) return;
   const provider = job.steps.findIndex(step => (step.run ?? "").trim() === prerequisite);
   if (provider < 0 || provider >= consumer) throw new Error(id + ": " + diagnostic);
  };
  for (const command of ["npm run verify -- p09-lineage", "npm run verify -- p09-recovery", "npm run verify -- p09-operations", "npm run perf -- p09", "npm run verify -- p09"]) {
   before(command, pgdgInstall, "Install official PGDG PostgreSQL 18 client tools before the recovery lanes");
   if (job.steps.some(step => step.run === command) && job.env?.SCOAT_PG_BIN !== "/usr/lib/postgresql/18/bin") throw new Error(id + ": Point SCOAT_PG_BIN at the installed PGDG client tools");
  }
  for (const command of [...suiteCommands.browser, ...(id === "protocol" ? ["npm run verify -- p05"] : []), "npm run verify -- p09-operations", "npm run perf -- p09", "npm run verify -- p09"]) before(command, chromiumInstall, "Install Chromium with its system dependencies before browser lanes");
  before("npm run verify -- p09-operations", systemdNode, "Provide setup-node's /usr/bin/node executable before systemd verification");
  if (job.steps.some(step => step.run === "npm run verify -- p09-operations")) {
   const node = job.steps.findIndex(step => step.uses === "actions/setup-node@v4");
   if (node < 0 || node >= job.steps.findIndex(step => step.run === systemdNode)) throw new Error(id + ": Provide setup-node's /usr/bin/node executable before systemd verification");
  }
  before("npm run verify -- p09", mediaInstall, "Install ffmpeg/ffprobe before story media");
 }
 const suites = Object.keys(suiteCommands);
 if (!same(Object.keys(workflow.jobs).sort(), [...suites, "foundation"].sort())) throw new Error("Hosted CI has exactly five suites and foundation");
 if (!onlyKeys(workflow, ["name", "on", "permissions", "concurrency", "jobs"]) || !same(workflow.permissions, { contents: "read" })) throw new Error("Hosted CI uses only the supported workflow form and read-only permissions");
 if (!onlyKeys(workflow.on, ["push", "pull_request"]) || Object.keys(workflow.on).length !== 2 || workflow.on.pull_request !== null || !same(workflow.on.push, { branches: ["main"] })) throw new Error("Hosted CI uses ordinary pull_request and push main only");
 if (!same(workflow.concurrency, { group: "${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.ref }}", "cancel-in-progress": true })) throw new Error("Scope cancellation by workflow, event and PR or ref");
 for (const id of suites) {
  const job = workflow.jobs[id];
  if (!onlyKeys(job, ["runs-on", "timeout-minutes", "services", "env", "steps"])) throw new Error(id + ": required jobs are unconditional, independent and fail closed");
  const pg = job.services?.postgres;
  if (!onlyKeys(job.services, ["postgres"]) || !onlyKeys(pg, ["image", "env", "ports", "options"]) || pg.image !== "postgres:17.6-alpine" || !same(pg.env, { POSTGRES_USER: "scoat", POSTGRES_PASSWORD: "fixture-only", POSTGRES_DB: "scoat" }) || !same(pg.ports, ["5432:5432"]) || pg.options !== '--health-cmd "pg_isready -U scoat" --health-interval 1s --health-timeout 5s --health-retries 30') throw new Error(id + ": require an isolated PostgreSQL 17.6 fixture service");
  const env = { DATABASE_URL: "postgres://scoat:fixture-only@localhost:5432/scoat", ...(id === "operations" ? { SCOAT_PG_BIN: "/usr/lib/postgresql/18/bin" } : {}) };
  if (!same(job.env, env)) throw new Error(id + ": require the fixture DATABASE_URL and matching tool environment");
  const steps = job.steps;
  const checkout = steps.findIndex(step => step.uses === "actions/checkout@v4");
  if (checkout !== 0 || !same(steps[checkout].with, { "fetch-depth": 0 })) throw new Error(id + ": fetch full source/history with fetch-depth: 0 before consumers");
  const node = steps.findIndex(step => step.uses === "actions/setup-node@v4");
  if (node !== 1 || !same(steps[node].with, { "node-version": "24.21.0" })) throw new Error(id + ": install pinned Node 24.21.0 before consumers");
  if (steps[2]?.run !== "npm ci" || steps[3]?.run !== "npm run build") throw new Error(id + ": npm ci and build precede every consumer");
  for (const command of new Set(suiteCommands[id])) {
   const count = steps.filter(step => step.run === command).length;
   if (count !== suiteCommands[id].filter(value => value === command).length || steps.findIndex(step => step.run === command) < 4) throw new Error(id + ": Hosted CI runs " + command + " with its exact repetition count after build");
  }
  if (!same(steps.filter(step => suiteCommands[id].includes(step.run)).map(step => step.run), suiteCommands[id])) throw new Error(id + ": required commands retain suite order");
  const allowed = new Set(["npm ci", "npm run build", ...suiteCommands[id], ...(id === "browser" || id === "operations" || id === "protocol" ? [chromiumInstall] : []), ...(id === "operations" ? [pgdgInstall, systemdNode, mediaInstall] : [])]);
  for (const [index, step] of steps.entries()) {
   if (id === "browser" && same(step, { run: "npm run verify -- auth-ui", env: { SCOAT_EVIDENCE_DIR: "auth-ui-evidence" } })) continue;
   if (id === "browser" && same(step, { uses: "actions/upload-artifact@v4", if: "always()", with: { name: "auth-ui-screenshots", path: "auth-ui-evidence", "if-no-files-found": "error" } })) continue;
   if (step.uses !== undefined && index > 1) throw new Error(id + ": source and Node setup occur only once before consumers");
   if (!onlyKeys(step, ["name", "run", "uses", "with"]) || (step.run !== undefined ? step.uses !== undefined || step.with !== undefined || !allowed.has(step.run.trim()) : !["actions/checkout@v4", "actions/setup-node@v4"].includes(step.uses))) throw new Error(id + ": supported literal steps only; no conditions, overrides, failure swallowing or background commands");
  }
 }
 const foundation = workflow.jobs.foundation;
 if (!onlyKeys(foundation, ["runs-on", "timeout-minutes", "needs", "if", "steps"]) || !Array.isArray(foundation.needs) || !same([...foundation.needs].sort(), [...suites].sort()) || foundation.if !== "${{ always() }}") throw new Error("foundation requires exactly five needs and always()");
 const steps = foundation.steps;
 if (steps?.length !== 2 || !same(steps[0], { uses: "actions/setup-node@v4", with: { "node-version": "24.21.0" } }) || !onlyKeys(steps[1], ["name", "env", "run"]) || !same(steps[1].env, { NEEDS_JSON: "${{ toJSON(needs) }}" }) || steps[1].run?.trim() !== aggregateCommand) throw new Error("foundation runs the exact fail-closed needs predicate after pinned Node");
}

export function checkLaneTools(lanes) {
 for (const { file, source } of lanes) {
  if (/\.local\/pg|p09\/s0|SCOAT_PG_BIN \?\?|SCOAT_PG_LIB \?\?|SCOAT_BASE_APP \?\?/.test(source)) throw new Error(`${file}: resolve lane tools from explicit environment or task scratch, never developer installs`);
 }
 const recovery = lanes.find(item => item.file === "scripts/verify-recovery.mjs")?.source ?? "";
 if (!/baseArtifact\(checkout, root, "6ec8b75"\)/.test(recovery)) throw new Error("Build the labeled 6ec8b75 base artifact inside task scratch");
 const tools = lanes.find(item => item.file === "scripts/lane-tools.mjs")?.source ?? "";
 if (!tools.includes('"--userconfig=" + devNull') || !tools.includes('!/^npm_config_/i.test(key)') || !tools.includes('env: installEnv')) throw new Error("Install the comparison artifact without inherited npm configuration or user config");
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
 const description = skill.split("---")[1] ?? "";
 if (!description.includes("end-to-end hunt and watch-notification performance") || description.includes("`perf -- p09` lineage overhead") || !selector.includes("features/story-performance.md") || !index.includes("[story performance](story-performance.md)")) throw new Error("Route P09 story performance through its current skill description, selector and feature index");
}

const pinnedNode = /^FROM node:24\.\d+\.\d+-bookworm-slim@sha256:[0-9a-f]{64} AS (build|runtime)$/;
const runtimeTail = 'USER node\nENTRYPOINT ["/usr/bin/tini", "--"]\nCMD ["node", "dist/railway.js"]';

function stringArrays(nodes, name) {
 const declaration = nodes.find(node => node.type === "VariableDeclarator" && node.id?.name === name);
 let object = declaration?.init;
 while (object && object.type !== "ObjectExpression" && object.type !== "ArrayExpression") object = object.expression;
 if (object?.type === "ArrayExpression") return object.elements.map(element => element.value);
 return Object.fromEntries((object?.properties ?? []).map(property => [property.key.name, property.value.elements.map(element => element.value)]));
}

export function checkDockerContext({ dockerfile, dockerignore }) {
 const sources = dockerfile.split("\n").filter(line => /^COPY /.test(line) && !/^COPY --from=/.test(line)).flatMap(line => line.split(/\s+/).slice(1, -1)).filter(source => source.startsWith("landing/"));
 if (!sources.length || sources.some(source => !/^landing\/public\/[a-zA-Z0-9.-]+$/.test(source))) throw new Error("Docker landing sources must be explicit public assets");
 const expected = ["landing/*", "!landing/public", "landing/public/*", ...sources.map(source => "!" + source)];
 const actual = dockerignore.split("\n").map(line => line.trim()).filter(line => /^!?landing(?:\/|$)/.test(line));
 if (!same(actual, expected)) throw new Error("Docker context must admit exactly the Dockerfile landing assets while excluding the rest of landing");
}

export function checkRailwayRuntime({ dockerfile, dockerignore, manifest, runtime }) {
 const lines = dockerfile.split("\n").filter(line => line.trim());
 if (lines.some(line => line.trimStart().startsWith("#"))) throw new Error("Dockerfile carries no comments");
 const froms = lines.filter(line => line.startsWith("FROM "));
 if (froms.length !== 2 || froms.some(line => !pinnedNode.test(line))) throw new Error("Build and runtime stages use the digest-pinned Node 24 bookworm-slim image");
 const stage = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));
 if (!/^ARG RAILWAY_GIT_COMMIT_SHA$/m.test(stage) || !stage.includes("grep -Eqx '[0-9a-f]{40}'")) throw new Error("Refuse an image build without the exact 40-hex source commit");
 if (!/sha256sum -c -/.test(stage) || !/postgresql-client-18=18\.\d+-\S+/.test(stage) || !/libpq5=18\.\d+-\S+/.test(stage) || !/tini=\S+/.test(stage)) throw new Error("Install pinned PGDG PostgreSQL 18 client tools and tini after checking the PGDG key digest");
 if (!/verifyRelease\(\)/.test(stage) || /recordRelease|createHash/.test(dockerfile)) throw new Error("Verify the copied release through its owner without re-recording or re-hashing it");
 if (/^COPY (--\S+ )*\.\s/m.test(dockerfile) || /^COPY .*(\.env|\.pem|deploy)/m.test(dockerfile)) throw new Error("Copy only release inputs, never the whole context, env files or keys");
 if (/^(ENV|ARG) .*(_JSON|_PEM|DATABASE_URL|PASSWORD|SECRET)/m.test(dockerfile)) throw new Error("Secrets enter only as runtime variables, never as image ENV or ARG");
 if (!/^ENV SCOAT_SOURCE_REVISION=\$\{RAILWAY_GIT_COMMIT_SHA\}/m.test(stage) || !stage.includes('org.opencontainers.image.revision="${RAILWAY_GIT_COMMIT_SHA}"')) throw new Error("Label and expose the exact source commit");
 if (lines.slice(-3).join("\n") !== runtimeTail) throw new Error("Run the unprivileged runtime under tini through dist/railway.js");
 const ignored = dockerignore.split("\n").map(line => line.trim());
 for (const entry of [".git", ".env", ".env.*", "**/node_modules", "dist", "*.pem"]) if (!ignored.includes(entry)) throw new Error("Exclude " + entry + " from the image build context");
 checkDockerContext({ dockerfile, dockerignore });
 const nodes = parsed(runtime);
 const variables = stringArrays(nodes, "runtimeVariables");
 const inherited = stringArrays(nodes, "inheritedVariables");
 const stripped = nodes.find(node => node.type === "VariableDeclarator" && node.id?.name === "stripped");
 if (!["server", "worker"].every(role => Array.isArray(variables[role]) && variables[role].includes("DATABASE_URL") && variables[role].includes("SCOAT_SOURCE_REVISION"))) throw new Error("Declare the required runtime variables for server and worker");
 if (!Array.isArray(inherited) || inherited.some(name => /_JSON$|_PEM$|DATABASE_URL/.test(name)) || /\.\.\.process\.env|env: process\.env/.test(runtime)) throw new Error("Children inherit only the named non-secret variables, never the whole environment");
 const forks = calls(nodes, "fork");
 if (!forks.length || forks.some(call => !/execArgv: \[\]/.test(textOf(runtime, call)))) throw new Error("Fork runtime children with an empty execArgv array");
 if (!/mode: 0o600, flag: "wx"/.test(runtime) || !/mkdtempSync\(/.test(runtime)) throw new Error("Materialize runtime secrets into fresh private 0600 files");
 const strippedText = stripped ? textOf(runtime, stripped.init) : "";
 if (!["forwarded", "x-forwarded-proto", "x-forwarded-host", "x-forwarded-for"].every(name => strippedText.includes('"' + name + '"'))) throw new Error("Never pass forwarded headers to the HTTPS server");
 if (/rejectUnauthorized: false/.test(runtime) || !/rejectUnauthorized: true/.test(runtime) || !/setHost: false/.test(runtime) || !/servername, ca, checkServerIdentity: verifyIssuer,/.test(runtime) || !/checkServerIdentity\(identity, peer\)/.test(runtime)) throw new Error("Re-originate TLS to the Node HTTPS server pinned to the configured certificate and issuer name");
 if (!/req\.headers\["x-forwarded-proto"\] !== "https"/.test(runtime)) throw new Error("Refuse non-health requests that did not arrive at the edge over HTTPS");
 if (/release\.json|createHash/.test(runtime)) throw new Error("The runtime supervisor never reads or hashes release metadata");
 for (const name of ["authConfigSchema", "watchConfigSchema", "listenHost"]) if (!nodes.some(node => node.type === "ImportSpecifier" && node.imported?.name === name)) throw new Error("Validate configuration through its owner: missing " + name);
 if (calls(nodes, "exit").filter(call => member(call.callee, "process", "exit") && call.arguments[0]?.value === 78).length < 2) throw new Error("Refuse missing or invalid runtime configuration with exit 78");
 const deadline = Number(/export const stopDeadlineMs = (\d+);/.exec(runtime)?.[1]);
 const parsedManifest = JSON.parse(manifest);
 if (parsedManifest.format !== "scoat-railway/1" || Object.keys(parsedManifest.services ?? {}).join() !== "server,worker") throw new Error("Railway manifest declares exactly the server and worker services");
 for (const role of ["server", "worker"]) {
  const service = parsedManifest.services[role];
  if (service.builder !== "DOCKERFILE" || service.dockerfilePath !== "Dockerfile" || service.startCommand !== null) throw new Error(`railway ${role}: build the Dockerfile and keep its tini entrypoint`);
  if (service.preDeployCommand !== "node scripts/database.mjs migrate") throw new Error(`railway ${role}: migrate through the shared release migrate before start`);
  if (service.healthcheckPath !== "/healthz") throw new Error(`railway ${role}: gate activation on /healthz`);
  if (service.restartPolicyType !== "ON_FAILURE" || !Number.isInteger(service.restartPolicyMaxRetries) || service.restartPolicyMaxRetries > 5) throw new Error(`railway ${role}: restart only on failure with a small retry bound`);
  if (!Number.isInteger(service.drainingSeconds) || !(service.drainingSeconds * 1000 > deadline)) throw new Error(`railway ${role}: drain longer than the supervisor stop deadline`);
  const names = Object.keys(service.variables ?? {});
  if (names.slice().sort().join() !== ["SCOAT_RUNTIME_ROLE", ...variables[role]].sort().join()) throw new Error(`railway ${role}: variables match the supervisor's required names`);
  if (service.variables.SCOAT_RUNTIME_ROLE.value !== role) throw new Error(`railway ${role}: select the role by SCOAT_RUNTIME_ROLE`);
  for (const [name, variable] of Object.entries(service.variables)) {
   if (/_JSON$|_PEM$/.test(name) && (variable.source !== "sealed-runtime-variable" || "value" in variable)) throw new Error(`railway ${role}: ${name} is a sealed runtime secret without a committed value`);
   if ("value" in variable && !["SCOAT_RUNTIME_ROLE", "SCOAT_EDGE_LISTEN_HOST"].includes(name)) throw new Error(`railway ${role}: ${name} carries no committed value`);
  }
  if (service.variables.DATABASE_URL.source !== "reference" || service.variables.DATABASE_URL.service !== parsedManifest.postgres?.service) throw new Error(`railway ${role}: DATABASE_URL references the PostgreSQL service`);
 }
}
