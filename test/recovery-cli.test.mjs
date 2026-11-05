import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseCommand } from "../dist/recovery.js";
import { bounded, libpqConnection, requireMajor, resolvePgTools, toolMajor, RecoveryRefused } from "../dist/recovery/tools.js";
import { scratchDirectory } from "../scripts/scratch.mjs";

const exec = promisify(execFile);
const refused = reason => error => error instanceof RecoveryRefused && error.reason === reason;
const seal = "0b7c8f0e-2f0a-4c3e-9a51-6f1d2e3c4b5a";

test("recovery commands parse strictly", () => {
 assert.deepEqual(parseCommand(["status"]), { command: "status" });
 assert.deepEqual(parseCommand(["seal"]), { command: "seal" });
 assert.deepEqual(parseCommand(["unseal", "--seal", seal]), { command: "unseal", seal });
 assert.deepEqual(parseCommand(["restore", "--archive", "/srv/scoat/handoff.dump"]), { command: "restore", archive: "/srv/scoat/handoff.dump" });
 assert.deepEqual(parseCommand(["admit"]), { command: "admit" });
 for (const argv of [[], ["frobnicate"], ["status", "extra"], ["status", "--seal", seal], ["unseal"], ["unseal", "--seal", "not-a-uuid"], ["restore"], ["restore", "--archive", "relative.dump"], ["admit", "--force"], ["seal", "--archive", "/x"]]) assert.throws(() => parseCommand(argv), refused("usage"), JSON.stringify(argv));
});

test("tool versions parse exactly and older clients refuse", () => {
 assert.equal(toolMajor("pg_dump", "pg_dump (PostgreSQL) 18.6 (Ubuntu 18.6-1.pgdg)\n"), 18);
 assert.equal(toolMajor("pg_restore", "pg_restore (PostgreSQL) 17.6"), 17);
 assert.throws(() => toolMajor("pg_dump", "pg_restore (PostgreSQL) 18.6"), refused("pg-tool-version"));
 assert.throws(() => toolMajor("pg_dump", "pg_dump 18"), refused("pg-tool-version"));
 assert.throws(() => requireMajor({ dump: "/x", restore: "/y", major: 16, library: null }, 17), refused("pg-tool-too-old"));
 assert.doesNotThrow(() => requireMajor({ dump: "/x", restore: "/y", major: 18, library: null }, 17));
});

test("tool connections carry no password and diagnostics stay bounded", () => {
 const connection = libpqConnection("postgres://owner:s3cr%40t@127.0.0.1:5432/scoat?options=-c%20search_path%3Dapp&sslmode=require");
 assert.equal(connection.password, "s3cr@t");
 assert.equal(connection.dbname, "postgres://owner@127.0.0.1:5432/scoat?sslmode=require");
 assert.equal(libpqConnection("postgres://owner@127.0.0.1/scoat").password, null);
 assert.throws(() => libpqConnection("postgres://owner:x@127.0.0.1/scoat?ssl=true"), refused("connection-parameter"));
 assert.throws(() => libpqConnection("mysql://owner:x@127.0.0.1/scoat"), refused("connection-parameter"));
 const text = bounded("connection to postgres://owner:hunter2@host/db failed password=hunter2 " + "x".repeat(1000));
 assert.ok(!text.includes("hunter2") && text.length <= 400);
});

test("tools resolve only from an explicit absolute SCOAT_PG_BIN with matching majors", async () => {
 await assert.rejects(resolvePgTools({}), refused("pg-bin-required"));
 await assert.rejects(resolvePgTools({ SCOAT_PG_BIN: "relative/bin" }), refused("pg-bin-required"));
 const root = await scratchDirectory("recovery-tools-");
 try {
  await assert.rejects(resolvePgTools({ SCOAT_PG_BIN: root }), refused("pg-tool-missing"));
  const fake = async (name, version) => { const file = path.join(root, name); await writeFile(file, "#!/bin/sh\necho '" + name + " (PostgreSQL) " + version + "'\n"); await chmod(file, 0o755); };
  await fake("pg_dump", "18.6");
  await fake("pg_restore", "17.6");
  await assert.rejects(resolvePgTools({ SCOAT_PG_BIN: root }), refused("pg-tool-version"));
  await fake("pg_restore", "18.6");
  assert.deepEqual(await resolvePgTools({ SCOAT_PG_BIN: root }), { dump: path.join(root, "pg_dump"), restore: path.join(root, "pg_restore"), major: 18, library: null });
 } finally { await rm(root, { recursive: true, force: true }); }
});

test("the compiled CLI reports typed refusals with exit codes", async () => {
 const cli = new URL("../dist/recovery.js", import.meta.url).pathname;
 const run = async (args, env) => { try { await exec(process.execPath, [cli, ...args], { env: { PATH: process.env.PATH, ...env } }); return null; } catch (error) { return { code: error.code, stderr: JSON.parse(String(error.stderr).trim()) }; } };
 assert.deepEqual(await run(["frobnicate"], {}), { code: 64, stderr: { event: "recovery_refused", reason: "usage" } });
 assert.deepEqual(await run(["status"], {}), { code: 78, stderr: { event: "recovery_refused", reason: "environment", name: "DATABASE_URL" } });
 assert.deepEqual(await run(["restore", "--archive", path.join(os.homedir(), "tmp/none.dump")], { SCOAT_SOURCE_DATABASE_URL: "postgres://a:b@127.0.0.1/x", SCOAT_TARGET_DATABASE_URL: "postgres://a:b@127.0.0.1/y" }), { code: 78, stderr: { event: "recovery_refused", reason: "pg-bin-required" } });
});
