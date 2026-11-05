import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkLineageBegin, checkLineageIdentity, checkRecoveryAuthority, checkRecoveryVerification } from "../scripts/check-lineage.mjs";

const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const lineage = read("src/db/lineage.ts"), transaction = read("src/db/transaction.ts");
const recovery = { handoff: read("src/recovery/handoff.ts"), recovery: read("src/recovery.ts"), tools: read("src/recovery/tools.ts"), index: read("src/index.ts") };
const routing = [read(".agents/skills/verify-scoat/SKILL.md"), read(".agents/skills/verify-scoat/features/README.md"), read("scripts/verify.mjs")];
const replaced = (source, from, to) => { assert.ok(source.includes(from), "missing " + from); return source.replace(from, to); };
const withRecovery = (field, from, to) => ({ ...recovery, [field]: replaced(recovery[field], from, to) });
const unsealHead = 'export async function unseal(pool: pg.Pool, sealId: string): Promise<"unsealed"> {';
const reopenPredicate = "seal_id=$1 AND consumed_by IS NULL AND identity";

test("unseal never reopens a consumed source; the original target-state exception fails", () => {
 assert.doesNotThrow(() => checkLineageBegin(lineage, transaction));
 const exception = replaced(replaced(lineage, unsealHead, 'export async function unseal(pool: pg.Pool, sealId: string, target: pg.Pool | null): Promise<"unsealed"> {\n const located = target === null ? null : await locateTarget(target);\n const reachable = located !== null && located.kind === "quarantined" ? located.target.locator : null;'), "[id]);\n  if (reopened.rowCount", "[id, reachable]);\n  if (reopened.rowCount");
 assert.throws(() => checkLineageBegin(replaced(exception, reopenPredicate, "seal_id=$1 AND (consumed_by IS NULL OR consumed_by=$2) AND identity"), transaction), /Unseal only before the source is consumed/);
 assert.throws(() => checkLineageBegin(exception, transaction), /Unseal takes no target/);
 assert.throws(() => checkLineageBegin(replaced(lineage, reopenPredicate, "seal_id=$1 AND identity"), transaction), /Unseal only before the source is consumed/);
});

test("source consumption and target bind keep the single-use authority chain; original unsafe shapes fail", () => {
 assert.throws(() => checkLineageBegin(replaced(lineage, "WHERE state='sealed' AND seal_id=$1 AND (consumed_by IS NULL OR consumed_by=$2) AND identity", "WHERE (consumed_by IS NULL OR consumed_by=$2) AND identity"), transaction), /Consume the source once/);
 assert.throws(() => checkLineageBegin(replaced(lineage, "AND (consumed_by IS NULL OR consumed_by=$2) AND identity", "AND identity"), transaction), /Consume the source once/);
 assert.throws(() => checkLineageBegin(replaced(lineage, " AND scoat_lineage_identity(xmin::text::numeric)=$2\", [target.sealId, target.locator, lineageSchemaHead]", "\", [target.sealId, target.locator, lineageSchemaHead]"), transaction), /Bind the same quarantined target/);
 assert.throws(() => checkLineageBegin(replaced(lineage, "  await designated(source, target, true);\n", ""), transaction), /Bind the same quarantined target/);
 assert.throws(() => checkLineageBegin(replaced(replaced(lineage, "  await designated(source, target, true);\n", ""), "  await pause(\"binding\");", "  await designated(source, target, true);\n  await pause(\"binding\");"), transaction), /Bind the same quarantined target/);
 assert.throws(() => checkLineageBegin(replaced(lineage, "return exclusive(target.pool, async client => {\n  await designated", "return (async (client) => {\n  await designated"), transaction), /bindTarget must run under the exclusive lineage fence/);
 assert.throws(() => checkLineageBegin(replaced(lineage, "  const result = await run(client);\n  if ((await client.query(quarantined, [target.sealId, target.locator])).rowCount !== 1) throw new LineageRefused(\"target-changed\");\n", "  const result = await run(client);\n"), transaction), /Migrate only a quarantined copy/);
 assert.throws(() => checkLineageBegin(replaced(lineage, " const state = await inspect(source);\n if (state.kind !== \"sealed\" || state.sealId !== originSeal", " await source.query(\"UPDATE scoat_lineage SET state='admitted', identity=scoat_lineage_identity(pg_current_xact_id()::text::numeric % 4294967296) WHERE identity=scoat_lineage_identity(xmin::text::numeric)\");\n const state = await inspect(source);\n if (state.kind !== \"sealed\" || state.sealId !== originSeal"), transaction), /belong to fenced seal, unseal, consume and bind only/);
 assert.throws(() => checkLineageBegin(replaced(lineage, "private constructor(readonly pool: pg.Pool, sealId", "constructor(readonly pool: pg.Pool, sealId"), transaction), /QuarantinedTarget is nominal/);
 const identityInputs = [read("db/migrations/0004_lineage.sql"), lineage, read("src/db/schema.ts"), read("db/migrations/meta/_journal.json")];
 assert.doesNotThrow(() => checkLineageIdentity(...identityInputs));
 assert.throws(() => checkLineageIdentity(identityInputs[0], replaced(lineage, "const targetSchema = z.strictObject({", "const targetSchema = z.object({"), identityInputs[2], identityInputs[3]), /Strictly parse/);
});

test("admit and restore order every check before consumption, tools and binding; original unsafe shapes fail", () => {
 assert.doesNotThrow(() => checkRecoveryAuthority(recovery));
 const consumeThenBind = " await consumeSource(o.source, target);\n await pause(\"consumed\");\n return bindTarget(target, o.source, pause);";
 assert.throws(() => checkRecoveryAuthority(withRecovery("handoff", consumeThenBind, " await bindTarget(target, o.source, pause);\n await consumeSource(o.source, target);\n return \"admitted\";")), /Admit checks the target and source/);
 assert.throws(() => checkRecoveryAuthority(withRecovery("handoff", " await designated(o.source, target, false);\n", "")), /Admit checks the target and source/);
 assert.throws(() => checkRecoveryAuthority({ ...recovery, handoff: replaced(replaced(recovery.handoff, " await consumeSource(o.source, target);\n await pause(\"consumed\");\n", ""), " await designated(o.source, target, false);\n", " await designated(o.source, target, false);\n await consumeSource(o.source, target);\n") }), /Admit checks the target and source/);
 assert.throws(() => checkRecoveryAuthority(withRecovery("handoff", "  await migrateQuarantined(target, client => applyPending(client, release));", "  await applyPending(await o.target.connect(), release);\n  await migrateQuarantined(target, async () => 0);")), /Apply target migrations only inside the quarantined migration transaction/);
 const freshCheck = " if (!await fresh(o.target)) throw new RecoveryRefused(\"target-not-fresh\");\n";
 assert.throws(() => checkRecoveryAuthority({ ...recovery, handoff: replaced(replaced(recovery.handoff, freshCheck, ""), " const located = await locateTarget(o.target);\n if (located.kind !== \"quarantined\"", freshCheck + " const located = await locateTarget(o.target);\n if (located.kind !== \"quarantined\"") }), /before running pg_dump and pg_restore/);
 assert.throws(() => checkRecoveryAuthority(withRecovery("handoff", " const bytes = await readFile(o.archive);", " await bindTarget(located.target, o.source, async () => undefined);\n const bytes = await readFile(o.archive);")), /never certifies itself/);
 assert.throws(() => checkRecoveryAuthority(withRecovery("handoff", "\"--dbname=\" + source.dbname", "\"--dbname=\" + o.sourceUrl")), /without its password/);
 assert.throws(() => checkRecoveryAuthority(withRecovery("tools", "timeout: 3600000, maxBuffer: 1 << 22, shell: false", "timeout: 3600000, maxBuffer: 1 << 22, shell: true")), /without a shell/);
 assert.throws(() => checkRecoveryAuthority(withRecovery("tools", "import { execFile } from \"node:child_process\";", "import { execFile, exec } from \"node:child_process\";")), /execFile argument arrays/);
 assert.throws(() => checkRecoveryAuthority(withRecovery("tools", " parsed.password = \"\";\n", "")), /Keep passwords out/);
 assert.throws(() => checkRecoveryAuthority(withRecovery("recovery", "strict: true", "strict: false")), /Parse recovery commands strictly/);
 assert.throws(() => checkRecoveryAuthority(withRecovery("recovery", "z.strictObject({ command: z.literal(\"admit\") })", "z.object({ command: z.literal(\"admit\") })")), /Parse recovery commands strictly/);
 assert.throws(() => checkRecoveryAuthority({ ...recovery, index: recovery.index + "\nexport { main } from \"./recovery.js\";\n" }), /public barrels/);
});

test("P09 recovery changes route to the recovery feature and runnable branch", () => {
 const [skill, index, runner] = routing;
 assert.doesNotThrow(() => checkRecoveryVerification(skill, index, runner));
 assert.throws(() => checkRecoveryVerification(skill.replace("P09 S2", "P09"), index, runner), /features\/recovery\.md/);
 assert.throws(() => checkRecoveryVerification(skill.replace("load [recovery](features/recovery.md)", "load recovery"), index, runner), /features\/recovery\.md/);
 assert.throws(() => checkRecoveryVerification(skill, index.replace("[recovery](recovery.md)", "recovery"), runner), /features\/recovery\.md/);
 assert.throws(() => checkRecoveryVerification(skill, index, runner.replace('process.argv[2] === "p09-recovery"', 'process.argv[2] === "p09-restore"')), /features\/recovery\.md/);
});
