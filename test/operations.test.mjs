import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { scratchDirectory } from "../scripts/scratch.mjs";
import { recordRelease, verifyRelease } from "../dist/release.js";
import { openPool } from "../dist/db/pool.js";
import { listenHost } from "../dist/server.js";

async function releaseRoot() {
 const root = await scratchDirectory("release-test-");
 for (const [file, text] of [["dist/server.js", "export {};\n"], ["dist/card/index.html", "<html></html>\n"], ["db/migrations/0000_a.sql", "SELECT 1;\n"], ["knowledge/releases/r.json", "{}\n"], ["package.json", "{}\n"], ["package-lock.json", "{}\n"], ["scripts/database.mjs", "export {};\n"]]) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
 }
 return root;
}

test("release digest is stable for the same inputs and refuses absent, malformed and changed releases", async () => {
 const root = await releaseRoot();
 try {
  const first = await recordRelease(root);
  assert.match(first, /^sha256:[0-9a-f]{64}$/);
  assert.equal(await recordRelease(root), first);
  assert.deepEqual(await verifyRelease(root).then(state => state.kind === "verified" ? state.release.digest : state.reason), first);
  await writeFile(path.join(root, "db/migrations/0000_a.sql"), "SELECT 2;\n");
  assert.deepEqual(await verifyRelease(root), { kind: "refused", reason: "artifact-inputs-changed" });
  await writeFile(path.join(root, "db/migrations/0000_a.sql"), "SELECT 1;\n");
  await writeFile(path.join(root, "dist/extra.js"), "export {};\n");
  assert.deepEqual(await verifyRelease(root), { kind: "refused", reason: "artifact-inputs-changed" });
  await rm(path.join(root, "dist/extra.js"));
  await symlink(path.join(root, "package.json"), path.join(root, "dist/link.js"));
  assert.deepEqual(await verifyRelease(root), { kind: "refused", reason: "artifact-inputs-changed" });
  await rm(path.join(root, "dist/link.js"));
  await rm(path.join(root, "knowledge"), { recursive: true });
  assert.deepEqual(await verifyRelease(root), { kind: "refused", reason: "artifact-inputs-changed" });
  await mkdir(path.join(root, "knowledge/releases"), { recursive: true });
  await writeFile(path.join(root, "knowledge/releases/r.json"), "{}\n");
  assert.equal((await verifyRelease(root)).kind, "verified");
  await writeFile(path.join(root, "dist/release.json"), JSON.stringify({ format: "scoat-release/1", digest: first, inputs: [{ path: "package.json", sha256: "0".repeat(64) }] }));
  assert.deepEqual(await verifyRelease(root), { kind: "refused", reason: "artifact-metadata-malformed" });
  await writeFile(path.join(root, "dist/release.json"), JSON.stringify({ format: "scoat-release/1", digest: first, inputs: [], extra: true }));
  assert.deepEqual(await verifyRelease(root), { kind: "refused", reason: "artifact-metadata-malformed" });
  await rm(path.join(root, "dist/release.json"));
  assert.deepEqual(await verifyRelease(root), { kind: "refused", reason: "artifact-metadata-absent" });
 } finally { await rm(root, { recursive: true, force: true }); }
});

test("an idle connection error is contained by the pool owner; the original raw pool throws", async () => {
 const owned = openPool({ connectionString: "postgres://nobody@127.0.0.1:9/none", max: 1 });
 const raw = new pg.Pool({ connectionString: "postgres://nobody@127.0.0.1:9/none", max: 1 });
 try {
  assert.doesNotThrow(() => owned.emit("error", new Error("terminating connection due to administrator command")));
  assert.throws(() => raw.emit("error", new Error("terminating connection due to administrator command")), /administrator command/);
 } finally { await owned.end(); await raw.end(); }
});

test("SCOAT_LISTEN_HOST accepts only exact IP literals and defaults to IPv4 loopback", () => {
 assert.equal(listenHost(undefined), "127.0.0.1");
 for (const value of ["127.0.0.1", "::1", "0.0.0.0", "::", "192.0.2.10", "2001:db8::1"]) assert.equal(listenHost(value), value);
 for (const value of ["", "localhost", " 127.0.0.1", "127.0.0.1:80", "[::1]", "fe80::1%lo", "256.0.0.1", "example.com"]) assert.equal(listenHost(value), null, value);
});
