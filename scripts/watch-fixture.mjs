import { execFile, fork } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { randomBytes, randomUUID } from "node:crypto";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import pg from "pg";
import { authFixture } from "./auth-fixture.mjs";
import { scratchDirectory } from "./scratch.mjs";
import { fixtureDelivery } from "./watch-delivery.mjs";
import { Watches, watchConfigSchema } from "../dist/memory/watches.js";
import { WatchQueue, queueSchemaFor } from "../dist/queue/index.js";
import { basisDigest } from "../dist/delivery/index.js";
import { resolveWatchTarget } from "../dist/memory/watches.js";

export const variant = 42531604922563;
export const productUrl = "https://thepihut.com/products/raspberry-pi-5?variant=" + variant;
const recording = name => gunzipSync(readFileSync(new URL("../fixtures/sellers/pihut/" + name, import.meta.url))).toString("utf8");
const marker = "_BISConfig.product = ";
export function sellerPages(state) {
 const original = recording("product-2026-11-05.html.gz"), delivery = recording("delivery-2026-11-05.html.gz");
 const start = original.indexOf(marker);
 const product = original.slice(0, start) + original.slice(start).replace(new RegExp(`("id":${variant},[^{}]*?"sku":")SC1431(")`), "$1" + (state.mode === "variant-changed" ? "SC0000" : "SC1431") + "$2").replace(new RegExp(`("id":${variant},[^{}]*?"available":)true`), "$1" + String(state.available)).replace(new RegExp(`("id":${variant},[^{}]*?"price":)\\d+`), "$1" + state.pence);
 const uk = delivery.indexOf('id="UnitedKingdom">');
 return { product, delivery: state.mode === "delivery-unknown" ? delivery.slice(0, uk) + delivery.slice(uk).replace("£3.80", "Free over £30") : delivery };
}

async function child(file, env, ready) {
 const process = fork(file, [], { execArgv: [], silent: true, env });
 const output = [];
 process.stdout.on("data", chunk => output.push(String(chunk)));
 process.stderr.on("data", chunk => output.push(String(chunk)));
 const message = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("child startup timeout " + output.join(""))), 30000);
  process.on("message", value => { if (ready(value)) { clearTimeout(timer); resolve(value); } });
  process.once("exit", code => { clearTimeout(timer); reject(new Error("child exited " + code + " " + output.join("").slice(-2000))); });
 });
 return { process, message, output };
}

export async function watchFixture(databaseUrl, { mailConfigured = true } = {}) {
 const root = await scratchDirectory("watch-");
 await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", root + "/seller-key.pem", "-out", root + "/seller-cert.pem", "-days", "1", "-subj", "/CN=thepihut.com", "-addext", "subjectAltName=DNS:thepihut.com,DNS:localhost,IP:127.0.0.1"], { timeout: 15000 });
 const sellerKey = await readFile(root + "/seller-key.pem"), sellerCert = await readFile(root + "/seller-cert.pem", "utf8");
 const state = { pence: 6620, available: true, mode: "ok", hits: 0 };
 const seller = createServer({ key: sellerKey, cert: sellerCert }, (req, res) => {
  state.hits++;
  if (state.mode === "blocked") { res.writeHead(403); res.end("blocked"); return; }
  if (state.mode === "private-redirect") { res.writeHead(302, { location: "https://[::ffff:127.0.0.1]/products/raspberry-pi-5" }); res.end(); return; }
  const pages = sellerPages(state);
  if (req.url === "/products/raspberry-pi-5") { res.writeHead(200, { "content-type": "text/html" }); res.end(pages.product); return; }
  if (req.url === "/pages/delivery") { res.writeHead(200, { "content-type": "text/html" }); res.end(pages.delivery); return; }
  res.writeHead(404); res.end();
 });
 await new Promise(resolve => seller.listen(0, "127.0.0.1", resolve));
 const sellerPort = seller.address().port;
 const mailKey = "fixture-" + randomBytes(8).toString("hex");
 const capture = await child(new URL("./mail-capture.mjs", import.meta.url), { ...process.env, CAPTURE_DIRECTORY: root, CAPTURE_KEY: root + "/seller-key.pem", CAPTURE_CERT: root + "/seller-cert.pem", CAPTURE_API_KEY: mailKey }, value => value.port);
 const mailOrigin = "https://localhost:" + capture.message.port;
 const accepted = [];
 const waiters = [];
 capture.process.on("message", value => { if (value.accepted) { accepted.push(value); for (const waiter of waiters.filter(item => item.key === value.accepted)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(value); } } });
 let config, bundle, isolatedUrl;
 const serverEnv = {};
 const f = await authFixture(databaseUrl, {
  entry: new URL("./watch-server.mjs", import.meta.url),
  beforeStart: async ({ issuer, root: authRoot, databaseUrl: url }) => {
   isolatedUrl = url;
   config = watchConfigSchema.parse({ issuer, from: "Scoat alerts <alerts@scoat.invalid>", unsubscribe: { version: "fixture-v1", keys: { "fixture-v1": randomBytes(32).toString("hex") } }, resendApiKey: mailConfigured ? mailKey : null });
   await writeFile(root + "/watch.json", JSON.stringify(config), { mode: 0o600 });
   bundle = root + "/ca-bundle.pem";
   await writeFile(bundle, (await readFile(authRoot + "/cert.pem", "utf8")) + sellerCert);
   Object.assign(serverEnv, { SCOAT_WATCH_CONFIG: root + "/watch.json", SCOAT_FIXTURE_SELLER_PORT: String(sellerPort), NODE_EXTRA_CA_CERTS: bundle });
  },
  env: serverEnv,
 }).catch(async error => { capture.process.kill("SIGKILL"); seller.close(); await rm(root, { recursive: true, force: true }); throw error; });
 const env = { ...process.env, DATABASE_URL: isolatedUrl, SCOAT_WATCH_CONFIG: root + "/watch.json", SCOAT_FIXTURE_SELLER_PORT: String(sellerPort), SCOAT_FIXTURE_MAIL_ORIGIN: mailOrigin, SCOAT_FIXTURE_MAIL_KEY: mailKey, NODE_EXTRA_CA_CERTS: bundle };
 Object.assign(f, { watchEnv: env });
 const defaults = getCACertificates("default");
 setDefaultCACertificates([...defaults, sellerCert]);
 const delivery = fixtureDelivery(env);
 const queueSchema = await queueSchemaFor(f.store.pool);
 if (!/^scoat_jobs_[0-9a-f]{32}$/.test(queueSchema)) throw new Error("Watch fixtures require an isolated queue schema");
 const producer = await WatchQueue.open(isolatedUrl, "producer");
 let worker = null;
 const fixture = {
  f, root, state, config, env, delivery, producer, queueSchema, sellerPort, mailOrigin, accepted,
  pool: f.store.pool,
  watches: pause => new Watches({ pool: f.store.pool, delivery, config, enqueue: producer, ...(pause ? { pause } : {}) }),
  waitAccepted: key => new Promise(resolve => { const found = accepted.find(item => item.accepted === key); if (found) resolve(found); else waiters.push({ key, resolve }); }),
  async hold(milliseconds) { await fetch(mailOrigin + "/control", { method: "POST", body: JSON.stringify({ holdMilliseconds: milliseconds }) }); },
  async deliveries() { return (await (await fetch(mailOrigin + "/deliveries")).text()).split("\n").filter(Boolean).map(line => JSON.parse(line)); },
  async requests() { return (await readFile(path.join(root, "requests.jsonl"), "utf8").catch(() => "")).split("\n").filter(Boolean).map(line => JSON.parse(line)); },
  async startWorker() { worker = await child(new URL("./watch-worker.mjs", import.meta.url), env, value => value.ready); return worker; },
  killWorker(signal = "SIGKILL") { const current = worker; worker = null; if (!current) return Promise.resolve(); return new Promise(resolve => { if (current.process.exitCode !== null) { resolve(); return; } current.process.once("exit", resolve); current.process.kill(signal); }); },
  async observe() { return delivery.observe(resolveWatchTarget({ url: productUrl }).target, AbortSignal.timeout(10000)); },
  async seedWatch({ baselinePence = 7000, targetPence = 6000, address = "seeded-" + randomUUID().slice(0, 8) + "@example.test", account = randomUUID(), incarnation = randomUUID() } = {}) {
   const saved = { ...state };
   Object.assign(state, { pence: baselinePence - 380, available: true, mode: "ok" });
   const observation = await this.observe();
   Object.assign(state, saved);
   if (observation.kind !== "comparable") throw new Error("Seed observation unavailable");
   const watch = randomUUID(), revision = randomUUID();
   await f.store.pool.query("INSERT INTO hunt_accounts(account,incarnation) VALUES($1,$2) ON CONFLICT DO NOTHING", [account, incarnation]);
   await f.store.pool.query("INSERT INTO watch_recipients(account,incarnation,revision,address) VALUES($1,$2,$3,$4) ON CONFLICT(account,incarnation) DO UPDATE SET address=EXCLUDED.address", [account, incarnation, revision, address]);
   const current = (await f.store.pool.query("SELECT revision FROM watch_recipients WHERE account=$1 AND incarnation=$2", [account, incarnation])).rows[0].revision;
   await f.store.pool.query("INSERT INTO watches(account,incarnation,id,hunt,target,basis,basis_digest,baseline_pence,baseline_observed_at,target_pence,recipient_revision,key_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9,$10,$11)", [account, incarnation, watch, "seeded-" + watch, resolveWatchTarget({ url: productUrl }).target, observation.basis, basisDigest(observation), baselinePence, targetPence, current, config.unsubscribe.version]);
   return { account, incarnation, watch, address };
  },
  async close() {
   const step = async (name, run) => { const started = Date.now(); let timer; try { await Promise.race([run(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(name + " timeout")), 20000); })]); } catch (error) { process.stderr.write(JSON.stringify({ event: "watch_fixture_close", step: name, error: String(error.message) }) + "\n"); } finally { clearTimeout(timer); } return Date.now() - started; };
   await step("worker", () => fixture.killWorker("SIGTERM"));
   await step("producer", () => producer.stop());
   await step("capture", () => new Promise(resolve => { capture.process.once("exit", resolve); capture.process.kill("SIGKILL"); }));
   await step("seller", () => new Promise(resolve => { seller.close(resolve); seller.closeAllConnections(); }));
   setDefaultCACertificates(defaults);
   await step("queue-schema", async () => { const admin = new pg.Pool({ connectionString: databaseUrl }); try { await admin.query("SET lock_timeout='5s'"); await admin.query(`DROP SCHEMA IF EXISTS ${queueSchema} CASCADE`); } finally { await admin.end(); } });
   await step("auth", () => f.close());
   await rm(root, { recursive: true, force: true });
  },
 };
 return fixture;
}
