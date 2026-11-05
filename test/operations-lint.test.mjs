import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { checkReadiness, checkReleaseOwner, checkPoolOwner, checkListenHost, checkLaneTools, checkDeployUnits, checkOperationsVerification } from "../scripts/check-operations.mjs";
import { checkWorkflow } from "../scripts/check-structure.mjs";

const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const original = (revision, file) => execFileSync("git", ["show", revision + ":" + file], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 1 << 24 });
const replaced = (source, from, to) => { assert.ok(source.includes(from), "missing " + from); return source.replace(from, to); };
const sources = [];
const collect = directory => { for (const entry of readdirSync(new URL("../" + directory, import.meta.url), { withFileTypes: true })) { const file = directory + "/" + entry.name; if (entry.isDirectory()) collect(file); else if (/\.tsx?$/.test(entry.name)) sources.push({ file, source: read(file) }); } };
collect("src");
const swap = (file, from, to) => sources.map(item => item.file === file ? { file, source: replaced(item.source, from, to) } : item);
const runtime = { server: read("src/server.ts"), worker: read("src/worker.ts"), readiness: read("src/readiness.ts"), database: read("scripts/database.mjs") };
const units = { migrate: read("deploy/systemd/scoat-migrate.service"), server: read("deploy/systemd/scoat-server.service"), worker: read("deploy/systemd/scoat-worker.service"), env: read("deploy/scoat.env.example") };
const healthLines = "      const report = await health(release, store?.pool ?? null, auth !== null, tls !== null);\n      res.writeHead(report.ready ? 200 : 503, { \"content-type\": \"application/json\" });";

test("health derives readiness from one verified-release report; the original phase-labelled health fails", () => {
 assert.doesNotThrow(() => checkReadiness(runtime));
 assert.throws(() => checkReadiness({ ...runtime, server: original("bd69b97", "src/server.ts") }), /fixed phase label/);
 assert.throws(() => checkReadiness({ ...runtime, server: replaced(runtime.server, "res.end(JSON.stringify(report));", "res.end(JSON.stringify({ ...report, phase: \"P08\" }));") }), /fixed phase label/);
 assert.throws(() => checkReadiness({ ...runtime, server: replaced(runtime.server, healthLines, "      const lineage = store ? await lineageStatus(store.pool) : \"unavailable\";\n      const ready = !!auth && lineage === \"admitted\";\n      const report = { ready, lineage };\n      res.writeHead(ready ? 200 : 503, { \"content-type\": \"application/json\" });") }), /shared readiness report/);
 assert.throws(() => checkReadiness({ ...runtime, server: replaced(runtime.server, "const release = await verifyRelease();", "const release = { kind: \"verified\" } as const;") }), /Verify the shipped release/);
 assert.throws(() => checkReadiness({ ...runtime, server: replaced(runtime.server, "if (store && configPath && release.kind === \"verified\")", "if (store && configPath)") }), /verified release/);
 assert.throws(() => checkReadiness({ ...runtime, server: replaced(runtime.server, "    if (release.kind !== \"verified\") {\n      res.writeHead(503", "    if (release.kind === \"absent\") {\n      res.writeHead(503") }), /non-health request/);
 assert.throws(() => checkReadiness({ ...runtime, readiness: replaced(runtime.readiness, "ready: reasons.length === 0", "ready: authConfigured") }), /absence of refusal reasons/);
 assert.throws(() => checkReadiness({ ...runtime, readiness: replaced(runtime.readiness, "  ...(encrypted ? [] : [\"transport-unencrypted\"]),\n", "") }), /missing encrypted/);
});

test("worker and migrate verify the release first; the original worker ready shape and unchecked migrate fail", () => {
 assert.throws(() => checkReadiness({ ...runtime, worker: original("bd69b97", "src/worker.ts") }), /verifies the release first/);
 assert.throws(() => checkReadiness({ ...runtime, worker: replaced(runtime.worker, "process.send({ ready: true, artifact: ready.artifact })", "process.send({ ready: true })") }), /release digest only after/);
 assert.throws(() => checkReadiness({ ...runtime, worker: replaced(runtime.worker, " let worker: Awaited", " if (process.send) process.send({ ready: true, artifact: verified.release.digest });\n let worker: Awaited") }), /only after admission/);
 assert.throws(() => checkReadiness({ ...runtime, database: original("bd69b97", "scripts/database.mjs") }), /Migrate verifies the release/);
});

test("one release owner hashes inputs once without hashing its own manifest", () => {
 const release = read("src/release.ts"), build = read("scripts/build.mjs");
 assert.doesNotThrow(() => checkReleaseOwner({ release, build, sources }));
 assert.throws(() => checkReleaseOwner({ release: replaced(release, ".filter(name => name !== releaseManifest)", ""), build, sources }), /own digest/);
 assert.throws(() => checkReleaseOwner({ release: replaced(release, "const manifestSchema = z.strictObject(", "const manifestSchema = z.object("), build, sources }), /strictly/);
 assert.throws(() => checkReleaseOwner({ release: replaced(release, "return { kind: \"refused\", reason: \"artifact-metadata-absent\" };", "return { kind: \"verified\", release: mint(\"sha256:\" + \"0\".repeat(64)) };"), build, sources }), /artifact-metadata-absent/);
 assert.throws(() => checkReleaseOwner({ release, build: original("bd69b97", "scripts/build.mjs"), sources }), /shared owner/);
 assert.throws(() => checkReleaseOwner({ release, build: build + "import { createHash } from \"node:crypto\";\n", sources }), /shared owner/);
 assert.throws(() => checkReleaseOwner({ release, build, sources: swap("src/worker.ts", "import { verifyRelease } from \"./release.js\";", "import { createHash } from \"node:crypto\";\nimport { verifyRelease } from \"./release.js\";") }), /never hash/);
 assert.throws(() => checkReleaseOwner({ release, build, sources: swap("src/server.ts", "const release = await verifyRelease();", "const release = await verifyRelease();\n  const manifest = \"dist/release.json\";") }), /only the release owner/);
});

test("database pools open only through the owner that handles idle connection loss", () => {
 assert.doesNotThrow(() => checkPoolOwner(sources));
 assert.throws(() => checkPoolOwner(sources.map(item => item.file === "src/hunt/postgres.ts" ? { file: item.file, source: original("bd69b97", item.file) } : item)), /src\/hunt\/postgres\.ts: open database pools only through openPool/);
 assert.throws(() => checkPoolOwner(swap("src/db/pool.ts", " pool.on(\"error\", () => { process.stderr.write(JSON.stringify({ event: \"database_connection_lost\" }) + \"\\n\"); });\n", "")), /idle connection errors/);
});

test("the listener binds only the parsed IP literal; the original fixed bind fails", () => {
 assert.doesNotThrow(() => checkListenHost(runtime.server));
 assert.throws(() => checkListenHost(original("bd69b97", "src/server.ts")), /strict IPv4 or IPv6/);
 assert.throws(() => checkListenHost(replaced(runtime.server, "server.listen(port, host,", "server.listen(port, \"0.0.0.0\",")), /parsed SCOAT_LISTEN_HOST/);
 assert.throws(() => checkListenHost(replaced(runtime.server, "z.union([z.ipv4(), z.ipv6()])", "z.string()")), /strict IPv4 or IPv6/);
 assert.throws(() => checkListenHost(replaced(runtime.server, "value ?? \"127.0.0.1\"", "value ?? \"0.0.0.0\"")), /defaults to 127\.0\.0\.1/);
});

test("hosted CI covers P07 and P09 lanes with PGDG tools and no developer installs; the original workflow fails", () => {
 const workflow = read(".github/workflows/ci.yaml");
 assert.doesNotThrow(() => checkWorkflow(workflow));
 assert.throws(() => checkWorkflow(original("bd69b97", ".github/workflows/ci.yaml")), /Hosted CI runs npm run verify -- p07-controls/);
 assert.throws(() => checkWorkflow(replaced(workflow, "postgresql-client-18\n", "postgresql-client\n")), /PGDG/);
 assert.throws(() => checkWorkflow(replaced(workflow, "      SCOAT_PG_BIN: /usr/lib/postgresql/18/bin\n", "      SCOAT_PG_BIN: /usr/lib/postgresql/18/bin\n      SCOAT_BASE_APP: /home/runner/base\n")), /developer homes/);
 assert.throws(() => checkWorkflow(replaced(workflow, "timeout-minutes: 60", "timeout-minutes: 240")), /timeout-minutes/);
 assert.throws(() => checkWorkflow(replaced(workflow, "      - run: npm run perf -- p09\n", "")), /perf -- p09/);
 assert.throws(() => checkWorkflow(original("9705fec", ".github/workflows/ci.yaml")), /\/usr\/bin\/node executable/);
 assert.throws(() => checkWorkflow(replaced(workflow, '        run: sudo ln -sfn "$(command -v node)" /usr/bin/node\n', '        run: node --version\n')), /\/usr\/bin\/node executable/);
});

test("P09 lanes resolve tools from explicit environment and build the base artifact in scratch; the S2 lanes fail", () => {
 const lanes = ["scripts/verify-lineage.mjs", "scripts/verify-recovery.mjs", "scripts/perf-lineage.mjs", "scripts/verify-operations.mjs", "scripts/lane-tools.mjs"].map(file => ({ file, source: read(file) }));
 assert.doesNotThrow(() => checkLaneTools(lanes));
 for (const file of ["scripts/verify-lineage.mjs", "scripts/verify-recovery.mjs"]) assert.throws(() => checkLaneTools(lanes.map(item => item.file === file ? { file, source: original("bd69b97", file) } : item)), /never developer installs/);
 assert.throws(() => checkLaneTools(lanes.map(item => item.file === "scripts/verify-recovery.mjs" ? { file: item.file, source: replaced(item.source, "baseArtifact(checkout, root, \"6ec8b75\")", "baseArtifact(checkout, root, \"HEAD\")") } : item)), /6ec8b75 base artifact/);
});

test("systemd units share one release and environment file, never restart exit 78, and the env example holds placeholders", () => {
 assert.doesNotThrow(() => checkDeployUnits(units));
 assert.throws(() => checkDeployUnits({ ...units, worker: replaced(units.worker, "RestartPreventExitStatus=78\n", "") }), /scoat-worker: never restart/);
 assert.throws(() => checkDeployUnits({ ...units, server: replaced(units.server, "Requires=scoat-migrate.service\n", "") }), /scoat-server: require and order after migrate/);
 assert.throws(() => checkDeployUnits({ ...units, worker: replaced(units.worker, "WorkingDirectory=/opt/scoat/release", "WorkingDirectory=/opt/scoat/other") }), /scoat-worker: share one release directory/);
 assert.throws(() => checkDeployUnits({ ...units, server: replaced(units.server, "ExecStart=/usr/bin/node /opt/scoat/release/dist/server.js", "ExecStart=/usr/bin/node /srv/elsewhere/dist/server.js") }), /scoat-server: execute only from the shared release directory/);
 assert.throws(() => checkDeployUnits({ ...units, migrate: replaced(units.migrate, "Before=scoat-server.service scoat-worker.service\n", "") }), /ordered before server and worker/);
 assert.throws(() => checkDeployUnits({ ...units, env: replaced(units.env, "REPLACE_WITH_PASSWORD@db.example.invalid", "hunter2@db.internal") }), /placeholder credentials/);
 assert.throws(() => checkDeployUnits({ ...units, env: replaced(units.env, "SCOAT_TLS_KEY=/etc/scoat/tls/key.pem\n", "") }), /exactly the required environment names/);
 assert.throws(() => checkDeployUnits({ ...units, env: units.env + "SCOAT_FIXTURE_SELLER_PORT=443\n" }), /exactly the required environment names/);
});

test("P09 operations route from the skill header, selector, feature index, verify branch and perf branch", () => {
 const skill = read(".agents/skills/verify-scoat/SKILL.md"), index = read(".agents/skills/verify-scoat/features/README.md"), runner = read("scripts/verify.mjs"), perf = read("scripts/perf.mjs");
 assert.doesNotThrow(() => checkOperationsVerification(skill, index, runner, perf));
 assert.throws(() => checkOperationsVerification(replaced(skill, "Also verifies P09 S3 operations", "Also verifies operations"), index, runner, perf), /Route P09 operations/);
 assert.throws(() => checkOperationsVerification(skill, replaced(index, "[operations](operations.md)", "operations"), runner, perf), /Route P09 operations/);
 assert.throws(() => checkOperationsVerification(skill, index, replaced(runner, "process.argv[2] === \"p09-operations\"", "process.argv[2] === \"p09-ops\""), perf), /Route P09 operations/);
 assert.throws(() => checkOperationsVerification(skill, index, runner, replaced(perf, "process.argv[2] === \"p09\"", "process.argv[2] === \"p9\"")), /Route P09 operations/);
 assert.throws(() => checkOperationsVerification(original("51a9388", ".agents/skills/verify-scoat/SKILL.md"), index, runner, perf), /Route P09 story performance/);
 assert.throws(() => checkOperationsVerification(replaced(skill, "end-to-end hunt and watch-notification performance", "lineage overhead"), index, runner, perf), /Route P09 story performance/);
 assert.throws(() => checkOperationsVerification(replaced(skill, "features/story-performance.md", "features/operations.md"), index, runner, perf), /Route P09 story performance/);
 assert.throws(() => checkOperationsVerification(skill, replaced(index, "[story performance](story-performance.md)", "story performance"), runner, perf), /Route P09 story performance/);
});
