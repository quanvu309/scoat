import { fork, type ChildProcess } from "node:child_process";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type OutgoingHttpHeaders, type Server } from "node:http";
import { Agent, request as tlsRequest } from "node:https";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import { constants, tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { authConfigSchema } from "./auth/config.js";
import { watchConfigSchema } from "./memory/watches.js";
import { listenHost } from "./server.js";

export const runtimeRoles = ["server", "worker"] as const;
export type RuntimeRole = (typeof runtimeRoles)[number];
export const runtimeVariables = {
 server: ["DATABASE_URL", "PORT", "SCOAT_EDGE_LISTEN_HOST", "SCOAT_SOURCE_REVISION", "SCOAT_AUTH_CONFIG_JSON", "SCOAT_CONTROL_CONFIG_JSON", "SCOAT_WATCH_CONFIG_JSON", "SCOAT_TLS_KEY_PEM", "SCOAT_TLS_CERT_PEM"],
 worker: ["DATABASE_URL", "PORT", "SCOAT_EDGE_LISTEN_HOST", "SCOAT_SOURCE_REVISION", "SCOAT_WATCH_CONFIG_JSON"],
} as const satisfies Record<RuntimeRole, readonly string[]>;
export const inheritedVariables = ["PATH", "NODE_EXTRA_CA_CERTS", "SCOAT_KNOWLEDGE_DIRECTORY", "SCOAT_PG_BIN"] as const;
export const stripped = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization", "proxy-authenticate", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "x-real-ip"]);
export const logLimit = Object.freeze({ linesPerSecond: 100, lineChars: 4096 });
export const stopDeadlineMs = 25000;

const roleSchema = z.enum(runtimeRoles);
const revisionSchema = z.string().regex(/^[0-9a-f]{40}$/);
const portSchema = z.string().regex(/^\d{1,5}$/).transform(Number).pipe(z.number().int().min(0).max(65535));
const databaseSchema = z.url({ protocol: /^postgres(ql)?$/ }).refine(value => { const url = new URL(value); return url.password !== "REPLACE_WITH_PASSWORD" && !placeholderHost(url.hostname); });
const pemSchema = z.string().min(1).max(65536);
const objectSchema = z.record(z.string(), z.unknown());
const serverMessageSchema = z.strictObject({ port: z.number().int().min(1).max(65535), host: z.string() });
const workerMessageSchema = z.strictObject({ ready: z.literal(true), artifact: z.string().regex(/^sha256:[0-9a-f]{64}$/) });

const bare = (hostname: string): string => hostname.replace(/^\[|\]$/g, "");

function placeholderHost(hostname: string): boolean {
 return /(^|\.)(invalid|example|test)$/.test(hostname) || /(^|\.)example\.(com|net|org)$/.test(hostname);
}

export type RuntimeConfig = Readonly<{
 role: RuntimeRole;
 databaseUrl: string;
 port: number;
 edgeHost: string;
 revision: string;
 issuerHost: string | null;
 files: Readonly<Record<string, string>>;
}>;
export type RuntimeRefusal = Readonly<{ missing: readonly string[]; invalid: readonly string[] }>;

function json(text: string): unknown {
 try {
  return JSON.parse(text);
 } catch {
  return undefined;
 }
}

export function runtimeConfig(role: RuntimeRole, env: NodeJS.ProcessEnv): RuntimeConfig | RuntimeRefusal {
 const missing = runtimeVariables[role].filter(name => !env[name]);
 if (missing.length) return { missing, invalid: [] };
 const invalid: string[] = [];
 const value = (name: string): string => env[name] ?? "";
 const database = databaseSchema.safeParse(value("DATABASE_URL"));
 if (!database.success) invalid.push("DATABASE_URL");
 const port = portSchema.safeParse(value("PORT"));
 if (!port.success) invalid.push("PORT");
 const edgeHost = env.SCOAT_EDGE_LISTEN_HOST ? listenHost(env.SCOAT_EDGE_LISTEN_HOST) : null;
 if (edgeHost === null) invalid.push("SCOAT_EDGE_LISTEN_HOST");
 const revision = revisionSchema.safeParse(value("SCOAT_SOURCE_REVISION"));
 if (!revision.success) invalid.push("SCOAT_SOURCE_REVISION");
 const watch = watchConfigSchema.safeParse(json(value("SCOAT_WATCH_CONFIG_JSON")));
 if (!watch.success || watch.data.resendApiKey === null || placeholderHost(new URL(watch.data.issuer).hostname)) invalid.push("SCOAT_WATCH_CONFIG_JSON");
 const files: Record<string, string> = { SCOAT_WATCH_CONFIG: value("SCOAT_WATCH_CONFIG_JSON") };
 let issuerHost: string | null = null;
 if (role === "server") {
  const auth = authConfigSchema.safeParse(json(value("SCOAT_AUTH_CONFIG_JSON")));
  const issuer = auth.success ? new URL(auth.data.issuer) : null;
  if (!issuer || placeholderHost(issuer.hostname) || (watch.success && watch.data.issuer !== issuer.origin)) invalid.push("SCOAT_AUTH_CONFIG_JSON");
  if (!objectSchema.safeParse(json(value("SCOAT_CONTROL_CONFIG_JSON"))).success) invalid.push("SCOAT_CONTROL_CONFIG_JSON");
  const key = pemSchema.safeParse(value("SCOAT_TLS_KEY_PEM"));
  const cert = pemSchema.safeParse(value("SCOAT_TLS_CERT_PEM"));
  let certificate: X509Certificate | null = null;
  try {
   certificate = cert.success ? new X509Certificate(cert.data) : null;
  } catch {
   certificate = null;
  }
  if (!certificate || Date.parse(certificate.validTo) <= Date.now() || (issuer && (isIP(bare(issuer.hostname)) ? certificate.checkIP(bare(issuer.hostname)) : certificate.checkHost(issuer.hostname)) === undefined)) invalid.push("SCOAT_TLS_CERT_PEM");
  let paired = false;
  try {
   paired = key.success && certificate !== null && certificate.checkPrivateKey(createPrivateKey(key.data));
  } catch {
   paired = false;
  }
  if (!paired) invalid.push("SCOAT_TLS_KEY_PEM");
  issuerHost = issuer ? bare(issuer.hostname) : null;
  Object.assign(files, { SCOAT_AUTH_CONFIG: value("SCOAT_AUTH_CONFIG_JSON"), SCOAT_CONTROL_CONFIG: value("SCOAT_CONTROL_CONFIG_JSON"), SCOAT_TLS_KEY: value("SCOAT_TLS_KEY_PEM"), SCOAT_TLS_CERT: value("SCOAT_TLS_CERT_PEM") });
 }
 if (invalid.length || !database.success || !port.success || edgeHost === null || !revision.success) return { missing: [], invalid };
 return { role, databaseUrl: database.data, port: port.data, edgeHost, revision: revision.data, issuerHost, files };
}

export class BoundedLog {
 private window = 0;
 private used = 0;
 private dropped = 0;
 constructor(private readonly limit = logLimit) {}
 write(stream: NodeJS.WritableStream, line: string): void {
  const now = Math.floor(Date.now() / 1000);
  if (now !== this.window) this.flush(now);
  if (this.used >= this.limit.linesPerSecond) {
   this.dropped += 1;
   return;
  }
  this.used += 1;
  stream.write((line.length > this.limit.lineChars ? line.slice(0, this.limit.lineChars) : line) + "\n");
 }
 flush(now = Math.floor(Date.now() / 1000)): void {
  if (this.dropped) process.stderr.write(JSON.stringify({ event: "log_suppressed", lines: this.dropped }) + "\n");
  this.window = now;
  this.used = 0;
  this.dropped = 0;
 }
}

export function forwardable(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
 const named = new Set(String(headers.connection ?? "").split(",").map(name => name.trim().toLowerCase()).filter(Boolean));
 const result: OutgoingHttpHeaders = {};
 for (const [name, value] of Object.entries(headers)) if (value !== undefined && !stripped.has(name) && !named.has(name)) result[name] = value;
 return result;
}

const log = new BoundedLog();
const event = (fields: Record<string, unknown>): void => log.write(process.stderr, JSON.stringify(fields));

function relay(child: ChildProcess): void {
 for (const [source, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]] as const) if (source) createInterface({ input: source, crlfDelay: Infinity }).on("line", line => log.write(target, line));
}

function exitCode(code: number | null, signal: NodeJS.Signals | null): number {
 if (code !== null) return code;
 return signal ? 128 + (constants.signals[signal] ?? 0) : 1;
}

function materialize(files: Readonly<Record<string, string>>): Readonly<{ directory: string; paths: Record<string, string> }> {
 const directory = mkdtempSync(path.join(tmpdir(), "scoat-runtime-"));
 const paths: Record<string, string> = {};
 for (const [name, content] of Object.entries(files)) {
  const file = path.join(directory, name.toLowerCase());
  writeFileSync(file, content, { mode: 0o600, flag: "wx" });
  paths[name] = file;
 }
 return { directory, paths };
}

function childEnvironment(config: RuntimeConfig, paths: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
 const env: NodeJS.ProcessEnv = {};
 for (const name of inheritedVariables) if (process.env[name]) env[name] = process.env[name];
 env.DATABASE_URL = config.databaseUrl;
 if (config.role === "server") Object.assign(env, { PORT: "0", SCOAT_LISTEN_HOST: "127.0.0.1" });
 return Object.assign(env, paths);
}

function supervise(config: RuntimeConfig): void {
 const secrets = materialize(config.files);
 const discard = (): void => rmSync(secrets.directory, { recursive: true, force: true });
 process.once("exit", discard);
 const entry = fileURLToPath(new URL(config.role === "server" ? "./server.js" : "./worker.js", import.meta.url));
 const child = fork(entry, [], { execArgv: [], env: childEnvironment(config, secrets.paths), stdio: ["ignore", "pipe", "pipe", "ipc"] });
 relay(child);
 const flusher = setInterval(() => log.flush(), 1000);
 flusher.unref();
 let listener: Server | null = null;
 let stopping = false;
 let workerArtifact: string | null = null;
 const ready = (fields: Record<string, unknown>): void => {
  discard();
  event({ event: "runtime_ready", role: config.role, revision: config.revision, ...fields });
  if (process.send) process.send({ ready: true, role: config.role, ...fields });
 };
 child.on("message", message => {
  if (config.role === "server") {
   const announced = serverMessageSchema.safeParse(message);
   if (!announced.success || listener) return;
   listener = edge(config, announced.data.port);
   listener.listen(config.port, config.edgeHost, () => {
    const address = listener?.address();
    ready({ port: address && typeof address !== "string" ? address.port : config.port });
   });
   return;
  }
  const announced = workerMessageSchema.safeParse(message);
  if (!announced.success || !listener || workerArtifact !== null) return;
  workerArtifact = announced.data.artifact;
  const address = listener.address();
  ready({ artifact: workerArtifact, port: address && typeof address !== "string" ? address.port : config.port });
 });
 if (config.role === "worker") {
  listener = createServer((req, res) => {
   res.setHeader("cache-control", "no-store");
   if (req.method !== "GET" || req.url !== "/healthz") {
    res.writeHead(404);
    res.end();
    return;
   }
   res.writeHead(workerArtifact ? 200 : 503, { "content-type": "application/json" });
   res.end(JSON.stringify(workerArtifact ? { ready: true, role: "worker", artifact: workerArtifact, revision: config.revision } : { ready: false, role: "worker" }));
  });
  listener.listen(config.port, config.edgeHost);
 }
 child.once("exit", (code, signal) => {
  const status = exitCode(code, signal);
  event({ event: "runtime_stopped", role: config.role, code: status, requested: stopping });
  listener?.close();
  listener?.closeAllConnections();
  log.flush();
  process.exit(status);
 });
 for (const name of ["SIGINT", "SIGTERM"] as const)
  process.on(name, () => {
   if (stopping) return;
   stopping = true;
   listener?.close();
   listener?.closeIdleConnections();
   child.kill("SIGTERM");
   setTimeout(() => child.kill("SIGKILL"), stopDeadlineMs).unref();
  });
}

function edge(config: RuntimeConfig, innerPort: number): Server {
 const ca = config.files.SCOAT_TLS_CERT ?? "";
 const identity = config.issuerHost ?? "";
 const servername = isIP(identity) ? undefined : identity;
 const verifyIssuer = (_: string, peer: import("node:tls").PeerCertificate): Error | undefined => checkServerIdentity(identity, peer);
 const agent = new Agent({ keepAlive: true, maxSockets: 128 });
 const refuse = (res: import("node:http").ServerResponse, status: number, body: string): void => {
  res.writeHead(status, { "content-type": "text/plain", "cache-control": "no-store" });
  res.end(body);
 };
 const server = createServer({ requestTimeout: 20000, headersTimeout: 15000, keepAliveTimeout: 65000, maxHeaderSize: 32768 }, (req, res) => {
  const health = req.method === "GET" && req.url === "/healthz";
  if (!health && req.headers["x-forwarded-proto"] !== "https") return refuse(res, 400, "HTTPS required");
  if (!health && req.headers.host === undefined) return refuse(res, 403, "");
  const headers = forwardable(req.headers);
  if (health) {
   headers.host = "127.0.0.1:" + innerPort;
   delete headers.origin;
  }
  const upstream = tlsRequest({ host: "127.0.0.1", port: innerPort, method: req.method, path: req.url, headers, setHost: false, servername, ca, checkServerIdentity: verifyIssuer, rejectUnauthorized: true, minVersion: "TLSv1.3", agent, timeout: 20000 }, response => {
   res.writeHead(response.statusCode ?? 502, forwardable(response.headers));
   response.pipe(res);
  });
  upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
  upstream.on("error", () => {
   event({ event: "edge_upstream_refused" });
   if (res.headersSent) res.destroy();
   else refuse(res, 502, "Upstream unavailable");
  });
  res.on("close", () => {
   if (!res.writableFinished) upstream.destroy();
  });
  req.pipe(upstream);
 });
 return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const role = roleSchema.safeParse(process.env.SCOAT_RUNTIME_ROLE);
 if (!role.success) {
  process.stderr.write(JSON.stringify({ event: "runtime_configuration_refused", reason: "SCOAT_RUNTIME_ROLE-not-server-or-worker" }) + "\n");
  process.exit(78);
 }
 const config = runtimeConfig(role.data, process.env);
 if ("missing" in config) {
  process.stderr.write(JSON.stringify({ event: "runtime_configuration_refused", role: role.data, missing: config.missing, invalid: config.invalid }) + "\n");
  process.exit(78);
 }
 event({ event: "runtime_start", role: config.role, revision: config.revision });
 supervise(config);
}
