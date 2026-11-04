import { createServer } from "node:https";
import { appendFileSync, existsSync, openSync, fsyncSync, closeSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

const directory = process.env.CAPTURE_DIRECTORY;
const keysPath = path.join(directory, "idempotency.json"), log = path.join(directory, "deliveries.jsonl"), requests = path.join(directory, "requests.jsonl");
const keys = existsSync(keysPath) ? JSON.parse(readFileSync(keysPath, "utf8")) : {};
let holdMilliseconds = 0;
const durable = (file, line) => { appendFileSync(file, JSON.stringify(line) + "\n"); const handle = openSync(file, "r+"); fsyncSync(handle); closeSync(handle); };
const persistKeys = () => { writeFileSync(keysPath + ".tmp", JSON.stringify(keys)); renameSync(keysPath + ".tmp", keysPath); };
const server = createServer({ key: readFileSync(process.env.CAPTURE_KEY), cert: readFileSync(process.env.CAPTURE_CERT) }, async (req, res) => {
 const chunks = [];
 for await (const chunk of req) chunks.push(chunk);
 const body = Buffer.concat(chunks).toString("utf8");
 if (req.url === "/control" && req.method === "POST") { holdMilliseconds = JSON.parse(body).holdMilliseconds; res.end("{}"); return; }
 if (req.url === "/deliveries" && req.method === "GET") { res.end(existsSync(log) ? readFileSync(log, "utf8") : ""); return; }
 if (req.url !== "/emails" || req.method !== "POST") { res.writeHead(404); res.end(); return; }
 if (req.headers.authorization !== "Bearer " + process.env.CAPTURE_API_KEY) { res.writeHead(401); res.end(JSON.stringify({ name: "missing_api_key" })); return; }
 const key = req.headers["idempotency-key"], digest = createHash("sha256").update(body).digest("hex");
 durable(requests, { key, digest, at: new Date().toISOString() });
 if (typeof key !== "string" || key.length < 1 || key.length > 256) { res.writeHead(400); res.end(JSON.stringify({ name: "invalid_idempotency_key" })); return; }
 const prior = keys[key];
 if (prior && prior.digest !== digest) { res.writeHead(409); res.end(JSON.stringify({ name: "invalid_idempotent_request" })); return; }
 let id = prior?.id;
 if (!prior) {
  id = randomUUID();
  keys[key] = { digest, id, at: Date.now() };
  persistKeys();
  durable(log, { id, key, digest, at: new Date().toISOString(), message: JSON.parse(body) });
  if (process.send) process.send({ accepted: key, id });
 }
 if (holdMilliseconds) await new Promise(resolve => setTimeout(resolve, holdMilliseconds));
 res.writeHead(200, { "content-type": "application/json" });
 res.end(JSON.stringify({ id }));
});
server.listen(0, "127.0.0.1", () => process.send?.({ port: server.address().port }));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
