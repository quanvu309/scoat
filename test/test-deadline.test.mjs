import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { scratchDirectory } from "../scripts/scratch.mjs";
import { stopFixtureProcess } from "../scripts/watch-resources.mjs";
import { checkTestTimeouts } from "../scripts/check-structure.mjs";

async function execute(args) {
 const env = { ...process.env };
 delete env.NODE_TEST_CONTEXT;
 const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], env });
 let output = "";
 child.stdout.on("data", chunk => { output += chunk; });
 child.stderr.on("data", chunk => { output += chunk; });
 try {
  const [code, signal] = await once(child, "close", { signal: AbortSignal.timeout(5000) });
  return { code, signal, output };
 } finally { await stopFixtureProcess(child, "SIGKILL"); }
}

test("npm test covers both file types with enforced test and file deadlines", async () => {
 const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
 assert.doesNotThrow(() => checkTestTimeouts(manifest));
 for (const replacement of ["--test-timeout=0", "--test-timeout=Infinity", "--test-timeout=600000", ""]) {
  assert.throws(() => checkTestTimeouts({ scripts: { test: manifest.scripts.test.replace("--test-timeout=120000", replacement) } }), /Bound every test/);
 }
 for (const removal of ["--import ./scripts/test-deadline.mjs ", "test/*.test.mjs", "test/*.test.ts"]) assert.throws(() => checkTestTimeouts({ scripts: { test: manifest.scripts.test.replace(removal, "") } }), /Bound every test/);
 assert.throws(() => checkTestTimeouts({ scripts: { test: manifest.scripts.test + " --test-force-exit" } }), /Bound every test/);
});

test("the file deadline fails a leaked HTTP handle and permits normal cleanup", async () => {
 const deadline = new URL("../scripts/test-deadline.mjs", import.meta.url).href;
 for (const leak of [false, true]) {
  const source = `import { createServer } from "node:http"; import { boundTestFile } from ${JSON.stringify(deadline)}; boundTestFile("fixture.mjs", 200); const server = createServer(); server.listen(0, "127.0.0.1", () => { ${leak ? "" : "server.close();"} });`;
  const result = await execute(["--input-type=module", "-e", source]);
  assert.equal(result.signal, null, result.output);
  assert.equal(result.code, leak ? 1 : 0, result.output);
  if (leak) {
   const failure = JSON.parse(result.output);
   assert.equal(failure.event, "test_file_timeout");
   assert.equal(failure.file, "fixture.mjs");
   assert.equal(failure.milliseconds, 200);
   assert.ok(failure.resources.includes("TCPServerWrap"));
  } else assert.equal(result.output, "");
 }
});

test("the native test timeout fails pending work and runs its cleanup", async () => {
 const root = await scratchDirectory("test-timeout-");
 const file = path.join(root, "pending.test.mjs");
 try {
  await writeFile(file, 'import test, { after } from "node:test"; const interval = setInterval(() => {}, 1000); after(() => clearInterval(interval)); test("pending work", () => new Promise(() => {}));');
  const result = await execute(["--test", "--test-reporter=spec", "--test-timeout=50", file]);
  assert.equal(result.signal, null, result.output);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /timed out after 50ms/);
  assert.doesNotMatch(result.output, /test_file_timeout/);
 } finally { await rm(root, { recursive: true, force: true }); }
});
