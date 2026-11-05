import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { scratchDirectory } from "../scripts/scratch.mjs";

const checkout = fileURLToPath(new URL("..", import.meta.url));

function query(port, pathname, deadline) {
 return new Promise((resolve, reject) => {
  let response;
  let bytes = 0;
  let finished = false;
  const outgoing = request({ host: "127.0.0.1", port, path: pathname, headers: { host: "localhost", "x-forwarded-proto": "https" } }, incoming => {
   response = incoming;
   incoming.on("data", chunk => { bytes += chunk.length; });
   incoming.on("end", () => finish("end"));
   incoming.on("aborted", () => finish("aborted"));
   incoming.on("error", () => undefined);
  });
  const timer = setTimeout(() => finish("deadline"), deadline);
  const finish = event => {
   if (finished) return;
   finished = true;
   clearTimeout(timer);
   resolve({ event, bytes });
   response?.destroy();
   outgoing.destroy();
  };
  outgoing.on("error", error => {
   if (!finished) {
    clearTimeout(timer);
    reject(error);
   }
  });
  outgoing.end();
 });
}

test("Railway supervisor preserves streams and reaps children on listener failure", { timeout: 40000 }, async t => {
 const root = await scratchDirectory("scoat-runtime-streams-");
 const children = [];
 let blocker;
 const launch = env => {
  const child = fork(path.join(root, "dist/railway.js"), [], { execArgv: [], env, silent: true });
  children.push(child);
  child.stdout.resume();
  child.stderr.resume();
  const exited = once(child, "exit");
  return { child, exited };
 };
 const stop = async process => {
  if (process.child.exitCode !== null || process.child.signalCode !== null) return;
  process.child.kill("SIGTERM");
  const timer = setTimeout(() => process.child.kill("SIGKILL"), 3000);
  try { await process.exited; } finally { clearTimeout(timer); }
 };
 try {
  await cp(path.join(checkout, "dist"), path.join(root, "dist"), { recursive: true });
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await symlink(path.join(checkout, "node_modules"), path.join(root, "node_modules"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(root, "key.pem"), "-out", path.join(root, "cert.pem"), "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
  const pidFile = path.join(root, "inner.pid");
  await writeFile(path.join(root, "dist/server.js"), `export {listenHost} from ${JSON.stringify(path.join(checkout, "dist/server.js"))};
import {createServer} from 'node:https';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
const server=createServer({key:readFileSync(process.env.SCOAT_TLS_KEY),cert:readFileSync(process.env.SCOAT_TLS_CERT),minVersion:'TLSv1.3'},(req,res)=>{
res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: first\\n\\n');
if(req.url==='/break')setTimeout(()=>res.destroy(),100);
});
server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port,host:'127.0.0.1'}));
process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
}`);
  const tmp = path.join(root, "runtime-tmp");
  await mkdir(tmp);
  const env = {
   PATH: process.env.PATH, TMPDIR: tmp, SCOAT_RUNTIME_ROLE: "server", DATABASE_URL: "postgres://local@127.0.0.1:9/local", PORT: "0", SCOAT_EDGE_LISTEN_HOST: "127.0.0.1", SCOAT_SOURCE_REVISION: "a".repeat(40),
   SCOAT_TLS_KEY_PEM: await readFile(path.join(root, "key.pem"), "utf8"), SCOAT_TLS_CERT_PEM: await readFile(path.join(root, "cert.pem"), "utf8"),
   SCOAT_CONTROL_CONFIG_JSON: "{}",
   SCOAT_AUTH_CONFIG_JSON: JSON.stringify({ issuer: "https://localhost/", loginMailKey: "fixture-only", loginMailFrom: "login@example.invalid", lifecycleKey: "a".repeat(64), lifecycleKeyVersion: "a", cookieKeys: ["a".repeat(32)], jwks: { keys: [{}] }, clients: [{ client_id: "local", redirect_uris: ["https://localhost/cb"] }] }),
   SCOAT_WATCH_CONFIG_JSON: JSON.stringify({ issuer: "https://localhost", from: "test@localhost", unsubscribe: { version: "a", keys: { a: "a".repeat(64) } }, resendApiKey: "local-dummy-never-sent" }),
  };
  const running = launch(env);
  const [ready] = await Promise.race([once(running.child, "message"), running.exited.then(() => { throw new Error("Supervisor exited before readiness"); })]);
  await t.test("an established SSE stream remains open past the header deadline", async () => {
   assert.deepEqual(await query(ready.port, "/stream", 23000), { event: "deadline", bytes: 13 });
  });
  await t.test("a truncated upstream aborts its downstream promptly", async () => {
   assert.deepEqual(await query(ready.port, "/break", 2000), { event: "aborted", bytes: 13 });
  });
  await t.test("a bind failure exits nonzero after reaping the child", async () => {
   blocker = createServer();
   blocker.listen(0, "127.0.0.1");
   await once(blocker, "listening");
   const collision = launch({ ...env, PORT: String(blocker.address().port) });
   const [code] = await collision.exited;
   assert.equal(code, 1);
   const pid = Number(await readFile(pidFile, "utf8"));
   let alive = false;
   try { process.kill(pid, 0); alive = true; } catch (error) { assert.equal(error.code, "ESRCH"); }
   if (alive) process.kill(pid, "SIGKILL");
   assert.equal(alive, false);
  });
 } finally {
  for (const child of children) await stop({ child, exited: once(child, "exit") });
  if (blocker?.listening) await new Promise(resolve => blocker.close(resolve));
  await rm(root, { recursive: true, force: true });
 }
});
