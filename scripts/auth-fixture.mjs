import { createServer } from "node:https";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { readFile, writeFile, rm, mkdir, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile, fork } from "node:child_process";
import { createWriteStream } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import Provider from "oidc-provider";
import pg from "pg";
import * as jose from "jose";
import assert from "node:assert/strict";
import { scratchDirectory } from "./scratch.mjs";
import { durableSchema } from "../dist/db/schema.js";
import { createIssuer } from "../dist/auth/issuer.js";
import { authSchema } from "../dist/auth/schema.js";
import { PostgresHuntStore } from "../dist/hunt/postgres.js";
const listen = (server) => new Promise((resolve) => server.listen(0, resolve));
const close = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });
export async function authFixture(databaseUrl) {
  const root = await scratchDirectory("auth-");
  await promisify(execFile)(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      root + "/key.pem",
      "-out",
      root + "/cert.pem",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { timeout: 15000 },
  );
  const key = await readFile(root + "/key.pem"),
    cert = await readFile(root + "/cert.pem", "utf8");
  const originalCAs = getCACertificates("default");
  setDefaultCACertificates([...originalCAs, cert]);
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const schema = "auth_" + randomBytes(16).toString("hex");
  await admin.query("CREATE SCHEMA " + schema);
  const isolated = new URL(databaseUrl);
  isolated.searchParams.set("options", "-c search_path=" + schema);
  databaseUrl = isolated.href;
  const store = new PostgresHuntStore({ databaseUrl });
  await store.pool.query(await durableSchema());
  await store.pool.query(authSchema);
  let identity = "upstream-subject-A",
    provider;
  const upstreamServer = createServer({ key, cert }, async (req, res) => {
    try {
      if (req.url.startsWith("/interaction/")) {
        const details = await provider.interactionDetails(req, res);
        if (details.prompt.name === "login")
          await provider.interactionFinished(
            req,
            res,
            { login: { accountId: identity } },
            { mergeWithLastSubmission: false },
          );
        else {
          const grant = new provider.Grant({
            clientId: details.params.client_id,
            accountId: details.session.accountId,
          });
          grant.addOIDCScope("openid");
          await provider.interactionFinished(
            req,
            res,
            { consent: { grantId: await grant.save() } },
            { mergeWithLastSubmission: true },
          );
        }
      } else await provider.callback()(req, res);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  const server = createServer({ key, cert });
  await listen(server);
  await listen(upstreamServer);
  const issuer = `https://127.0.0.1:${server.address().port}`,
    upstreamIssuer = `https://localhost:${upstreamServer.address().port}`;
  const { privateKey } = await jose.generateKeyPair("RS256", {
    extractable: true,
  });
  const jwks = {
    keys: [
      {
        ...(await jose.exportJWK(privateKey)),
        kid: "test-key",
        alg: "RS256",
        use: "sig",
      },
    ],
  };
  provider = new Provider(upstreamIssuer, {
    jwks,
    cookies: { keys: [randomBytes(32).toString("hex")] },
    features: { devInteractions: { enabled: false } },
    clients: [
      {
        client_id: "scoat-upstream",
        client_secret: "test-upstream-secret",
        redirect_uris: [issuer + "/upstream/callback"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        token_endpoint_auth_method: "client_secret_basic",
      },
    ],
    findAccount: (_ctx, id) => ({
      accountId: id,
      claims: () => ({ sub: id, email: "same@example.invalid" }),
    }),
  });
  const config = {
    issuer,
    upstreamIssuer,
    upstreamClientId: "scoat-upstream",
    upstreamClientSecret: "test-upstream-secret",
    lifecycleKey: randomBytes(32).toString("hex"),
    lifecycleKeyVersion: "disposable-fixture",
    cookieKeys: [randomBytes(32).toString("hex")],
    jwks,
    clients: ["host-one", "host-two"].map((client_id) => ({
      client_id,
      redirect_uris: ["https://client.example/cb"],
    })),
  };
  await cp(new URL("../knowledge/releases",import.meta.url),root+"/releases",{recursive:true});
  await writeFile(root + "/auth.json", JSON.stringify(config), { mode: 0o600 });
  const port = server.address().port;
  await close(server);
  let child;
  const logs = path.join(os.homedir(), "tmp/scoat-delivery/p05/logs");
  await mkdir(logs, { recursive: true });
  const logPath=path.join(logs,path.basename(root)+".log");
  const log = createWriteStream(logPath, {
    flags: "a",
  });
  async function startService() {
    child = fork(new URL("../dist/server.js", import.meta.url), [], {
      execArgv: [],
      silent: true,
      env: {
        ...process.env,
        PORT: String(port),
        SCOAT_AUTH_CONFIG: root + "/auth.json",
        SCOAT_KNOWLEDGE_DIRECTORY: root+"/releases",
        DATABASE_URL: databaseUrl,
        SCOAT_TLS_KEY: root + "/key.pem",
        SCOAT_TLS_CERT: root + "/cert.pem",
        NODE_EXTRA_CA_CERTS: root + "/cert.pem",
      },
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Service startup timeout"));
      }, 30000);
      child.once("message", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error("Service exited during startup: " + code));
      });
    });
  }
  async function stopService() {
    if (child.exitCode !== null) return;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Service shutdown timeout"));
      }, 10000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }
  try {
    await startService();
  } catch (error) {
    await close(upstreamServer);
    await store.close();
    await admin.query("DROP SCHEMA " + schema + " CASCADE");
    await admin.end();
    log.end();
    setDefaultCACertificates(originalCAs);
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  const jar = new Map();
  async function browser(url, init = {}) {
    const origin = new URL(url).origin;
    const cookies = jar.get(origin) ?? new Map();
    jar.set(origin, cookies);
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: {
        ...init.headers,
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      },
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }
  async function login(
    client = "host-one",
    subject = "upstream-subject-A",
    scope = "scoat:read scoat:write",
    pauseAtCallback = false,
  ) {
    identity = subject;
    jar.clear();
    const verifier = randomBytes(32).toString("base64url"),
      state = randomBytes(32).toString("hex");
    const params = new URLSearchParams({
      client_id: client,
      redirect_uri: "https://client.example/cb",
      response_type: "code",
      scope: "openid " + scope,
      resource: issuer + "/mcp",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    let url = issuer + "/auth?" + params;
    const steps = [];
    for (let n = 0; n < 30 && !url.startsWith("https://client.example/"); n++) {
      if (pauseAtCallback && new URL(url).pathname === "/upstream/callback") return {callback:url,cookie:[...(jar.get(issuer) ?? [])].map(([key,value])=>`${key}=${value}`).join("; ")};
      let response = await browser(url);
      steps.push({ path: new URL(url).pathname, status: response.status });
      if (response.status === 200 && new URL(url).pathname === "/upstream/callback") {
        const html = await response.text();
        const confirmation = html.match(/name="confirmation" value="([^"]+)"/)?.[1];
        assert.ok(confirmation,html);
        response = await browser(issuer+"/account/enroll",{method:"POST",headers:{origin:issuer,"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({confirmation,decision:"enroll"})});
        steps.push({path:"/account/enroll",status:response.status});
      }
      if (
        response.status === 200 &&
        new URL(url).pathname.startsWith("/interaction/")
      ) {
        const html = await response.text();
        const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1];
        assert.ok(csrf, html);
        for (const body of [
          new URLSearchParams({ csrf }),
          new URLSearchParams({ decision: "allow", csrf: "forged" }),
        ]) {
          const refused = await browser(url, {
            method: "POST",
            headers: {
              origin: issuer,
              "content-type": "application/x-www-form-urlencoded",
            },
            body,
          });
          assert.equal(refused.status, 403);
          steps.push({ path: new URL(url).pathname, status: refused.status });
        }
        response = await browser(url, {
          method: "POST",
          headers: {
            origin: issuer,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ csrf, decision: "allow" }),
        });
      }
      assert.ok(
        [302, 303].includes(response.status),
        JSON.stringify({
          url,
          status: response.status,
          body: await response.text(),
          steps,
        }),
      );
      url = new URL(response.headers.get("location"), url).href;
    }
    const callback = new URL(url);
    assert.equal(callback.searchParams.get("state"), state, JSON.stringify({ url, steps }));
    const code = callback.searchParams.get("code");
    assert.ok(code, url);
    const response = await fetch(issuer + "/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client,
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: "https://client.example/cb",
        resource: issuer + "/mcp",
      }),
    });
    const tokens = await response.json();
    assert.equal(response.status, 200, JSON.stringify(tokens));
    return { token: tokens.access_token, steps, client };
  }
  async function link(current, candidate) {
    identity = current;
    jar.delete(upstreamIssuer);
    let response = await browser(issuer + "/account/link");
    let callbacks = 0;
    const steps = [];
    let previousUrl = issuer;
    for (let n = 0; n < 20 && [302, 303].includes(response.status); n++) {
      const url = new URL(response.headers.get("location"), previousUrl);
      previousUrl = url.href;
      if (url.pathname === "/upstream/callback") callbacks++;
      response = await browser(url);
      steps.push({ path: url.pathname, status: response.status });
      if (callbacks === 1 && url.pathname === "/upstream/callback") {
        identity = candidate;
        jar.delete(upstreamIssuer);
        if (response.status === 200) {
          const html = await response.text();
          const confirmation = html.match(/name="confirmation" value="([^"]+)"/)?.[1];
          assert.ok(confirmation, html);
          const denied = await browser(issuer + "/account/link", {
            method: "POST", headers: { origin: issuer },
            body: new URLSearchParams({ confirmation: "forged" }),
          });
          assert.equal(denied.status, 400);
          response = await browser(issuer + "/account/link", {
            method: "POST", headers: { origin: issuer },
            body: new URLSearchParams({ confirmation }),
          });
          const replay = await browser(issuer + "/account/link", {
            method: "POST", headers: { origin: issuer },
            body: new URLSearchParams({ confirmation }),
          });
          assert.equal(replay.status, 400);
        }
      }
    }
    return { status: response.status, text: await response.text(), steps };
  }
  const interactions = [];
  const redact = (value) =>
    Array.isArray(value)
      ? value.map(redact)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
              key,
              ["grant", "access_token", "code", "state", "csrf"].includes(key)
                ? "[redacted]"
                : redact(item),
            ]),
          )
        : value;
  let id = 0;
  async function rpc(token, method, params = {}) {
    const response = await fetch(issuer + "/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    const reply = {
      status: response.status,
      timing: response.headers.get("server-timing"),
      challenge: response.headers.get("www-authenticate"),
      body: response.headers.get("content-type")?.includes("application/json")
        ? await response.json()
        : await response.text(),
    };
    interactions.push(redact({ method, params, ...reply }));
    return reply;
  }
  const tool = async (token, name, args) => {
    const reply = await rpc(token, "tools/call", { name, arguments: args });
    assert.equal(reply.status, 200, JSON.stringify(reply));
    return reply.body.error
      ? { isError: true, error: reply.body.error }
      : reply.body.result;
  };
  const boundary = await createIssuer(config, store.pool);
  return {
    issuer,
    knowledgeDirectory: root+"/releases",
    logPath,
    store,
    authenticate: (token) => boundary.authenticate({ headers: { authorization: "Bearer " + token } }),
    login,
    link,
    rpc,
    tool,
    config,
    browser,
    interactions,
    setIdentity(value) {
      identity = value;
    },
    async restart() {
      await stopService();
      await startService();
    },
    async close() {
      await stopService();
      await close(upstreamServer);
      await store.close();
      await admin.query("DROP SCHEMA " + schema + " CASCADE");
      await admin.end();
      log.end();
      setDefaultCACertificates(originalCAs);
      await rm(root, { recursive: true, force: true });
    },
  };
}
