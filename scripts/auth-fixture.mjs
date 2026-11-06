import { createServer } from "node:https";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { readFile, writeFile, rm, mkdir, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile, fork } from "node:child_process";
import { createWriteStream } from "node:fs";
import { randomBytes, createHash } from "node:crypto";

import pg from "pg";
import * as jose from "jose";
import assert from "node:assert/strict";
import { scratchDirectory } from "./scratch.mjs";
import { stopFixtureProcess } from "./watch-resources.mjs";
import { durableSchema } from "../dist/db/schema.js";
import { migrateFixtureDatabase } from "./fixture-journal.mjs";
import { createIssuer } from "../dist/auth/issuer.js";
import { authSchema } from "../dist/auth/schema.js";
import { PostgresHuntStore } from "../dist/hunt/postgres.js";
const listen = (server) => new Promise((resolve) => server.listen(0, resolve));
const close = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });
export async function authFixture(databaseUrl, options = {}) {
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
  await migrateFixtureDatabase(admin);
  const schema = "auth_" + randomBytes(16).toString("hex");
  await admin.query("CREATE SCHEMA " + schema);
  const isolated = new URL(databaseUrl);
  isolated.searchParams.set("options", "-c search_path=" + schema);
  databaseUrl = isolated.href;
  const store = new PostgresHuntStore({ databaseUrl });
  await store.pool.query(await durableSchema());
  await store.pool.query(authSchema);
  let identity = "upstream-subject-A";
  const mail = [];
  const mailServer = createServer({ key, cert }, async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    mail.push(JSON.parse(body));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: randomBytes(16).toString("hex") }));
  });
  const server = createServer({ key, cert });
  await listen(server);
  await listen(mailServer);
  const issuer = `https://127.0.0.1:${server.address().port}`;
  const mailOrigin = `https://localhost:${mailServer.address().port}`;
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
  const config = {
    issuer,
    loginMailKey: "fixture-only",
    loginMailFrom: "login@scoat.invalid",
    lifecycleKey: randomBytes(32).toString("hex"),
    lifecycleKeyVersion: "disposable-fixture",
    cookieKeys: [randomBytes(32).toString("hex")],
    jwks,
    ...(options.registration ? { registrationClientId: "scoat-chatgpt", registrationKeys: [{ version: "fixture", secret: randomBytes(32).toString("hex") }] } : {}),
    clients: ["host-one", "host-two"].map((client_id) => ({
      client_id,
      redirect_uris: ["https://client.example/cb"],
    })).concat(options.registration ? [{ client_id: "scoat-chatgpt", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"] }] : []),
  };
  await cp(new URL("../knowledge/releases",import.meta.url),root+"/releases",{recursive:true});
  await writeFile(root + "/auth.json", JSON.stringify(config), { mode: 0o600 });
  const controlConfig={version:1,keyId:"fixture",secret:randomBytes(32).toString("hex")};
  await writeFile(root+"/control.json",JSON.stringify(controlConfig),{mode:0o600});
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
    child = fork(options.entry ?? new URL("./auth-server.mjs", import.meta.url), [], {
      execArgv: [],
      silent: true,
      env: {
        ...process.env,
        PORT: String(port),
        SCOAT_FIXTURE_LOGIN_MAIL: mailOrigin,
        SCOAT_AUTH_CONFIG: root + "/auth.json",
        SCOAT_CONTROL_CONFIG: root+"/control.json",
        SCOAT_KNOWLEDGE_DIRECTORY: root+"/releases",
        DATABASE_URL: databaseUrl,
        SCOAT_TLS_KEY: root + "/key.pem",
        SCOAT_TLS_CERT: root + "/cert.pem",
        NODE_EXTRA_CA_CERTS: root + "/cert.pem",
        ...options.env,
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
    await stopFixtureProcess(child);
  }
  try {
    await options.beforeStart?.({ issuer, root, databaseUrl, config });
    await startService();
  } catch (error) {
    await close(mailServer);
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
  const addresses = new Map(), loginSessions = new Map();
  function addressFor(value = identity) { return addresses.get(value) ?? (value.replaceAll(/[^A-Za-z0-9-]/g, "-") + "@example.invalid").toLowerCase(); }
  async function subjectFor(value = identity) {
    const row = (await store.pool.query("SELECT subject FROM login_addresses WHERE email=$1", [addressFor(value)])).rows[0];
    assert.ok(row, value);
    return row.subject;
  }
  async function advanceLoginWindow() {
    interactions.push({condition:"login.budget-window",boundary:"SYNTHETIC expire login quota windows between independent legacy regression cases"});
    await store.pool.query("DELETE FROM login_mail_budget");
  }
  async function prepareCode(response) {
    await advanceLoginWindow();
    const html = await response.text();
    const state = html.match(/name="state" value="([^"]+)"/)?.[1];
    assert.ok(state, html);
    const sent = await browser(issuer + "/login/send", { method: "POST", headers: { origin: issuer }, body: new URLSearchParams({ state, email: addressFor() }) });
    assert.equal(sent.status, 200);
    const code = mail.at(-1)?.text.match(/[0-9]{6}/)?.[0];
    assert.ok(code);
    return { callback: issuer + "/login/complete", method: "POST", body: new URLSearchParams({state,code}), cookie: [...(jar.get(issuer) ?? [])].map(([key,value])=>`${key}=${value}`).join("; ") };
  }
  async function codeLogin(response) {
    const pending = await prepareCode(response);
    return browser(pending.callback, { method: pending.method, headers: {origin:issuer}, body:pending.body });
  }
  async function nativeLogin(page, advance = true) {
    if (!await page.locator('form[action="/login/send"]').count()) return;
    if (advance) await advanceLoginWindow();
    await page.getByLabel("Email", {exact:true}).fill(addressFor());
    const sent = page.waitForResponse(response => response.url() === issuer + "/login/send" && response.request().method() === "POST");
    await page.getByRole("button", {name:"Send code",exact:true}).click();
    assert.equal((await sent).status(),200);
    await page.getByLabel("Code", {exact:true}).fill(mail.at(-1).text.match(/[0-9]{6}/)[0]);
    await page.getByRole("button",{name:"Continue",exact:true}).click();
    await page.locator('form[action="/login/send"]').waitFor({state:"detached"});
  }
  async function login(
    client = "host-one",
    subject = "upstream-subject-A",
    scope = "scoat:read scoat:write",
    pauseAtCallback = false,
    registeredRedirect,
  ) {
    identity = subject;
    const prior = !pauseAtCallback && loginSessions.get(addressFor(subject));
    jar.clear();
    if (prior) jar.set(issuer,new Map([["__Host-scoat-session",prior]]));
    const redirect = registeredRedirect ?? config.clients.find(value => value.client_id === client)?.redirect_uris[0];
    assert.ok(redirect);
    const verifier = randomBytes(32).toString("base64url"),
      state = randomBytes(32).toString("hex");
    const params = new URLSearchParams({
      client_id: client,
      redirect_uri: redirect,
      response_type: "code",
      scope: "openid " + scope,
      resource: issuer + "/mcp",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    let url = issuer + "/auth?" + params;
    const steps = [], interactionCookies = [];
    for (let n = 0; n < 30 && !url.startsWith(redirect); n++) {
      let response = await browser(url);
      interactionCookies.push(...response.headers.getSetCookie().filter(cookie => /^_interaction(?:_resume)?=/.test(cookie)));
      steps.push({ path: new URL(url).pathname, status: response.status });
      if (response.status === 200 && (await response.clone().text()).includes('action="/login/send"')) {
        if (pauseAtCallback) return { ...await prepareCode(response), interactionCookies };
        response = await codeLogin(response);
      }
      if (response.status === 200 && (await response.clone().text()).includes('action="/account/enroll"')) {
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
        assert.ok(html.includes("Stays connected while you use it"), "refresh-capable clients must disclose background renewal");
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
        redirect_uri: redirect,
        resource: issuer + "/mcp",
      }),
    });
    const tokens = await response.json();
    assert.equal(response.status, 200, JSON.stringify(tokens));
    loginSessions.set(addressFor(subject),jar.get(issuer)?.get("__Host-scoat-session"));
    return { token: tokens.access_token, refresh: tokens.refresh_token, steps, client };
  }
  async function link(current, candidate, pauseAtCandidate = false, beforeCandidate) {
    identity = current;
    let response = await codeLogin(await browser(issuer + "/account/link"));
    if (response.status !== 200) return {status:response.status,text:await response.text(),steps:[]};
    const html = await response.text();
    const confirmation = html.match(/name="confirmation" value="([^"]+)"/)?.[1];
    assert.ok(confirmation,html);
    assert.equal((await browser(issuer+"/account/link",{method:"POST",headers:{origin:issuer},body:new URLSearchParams({confirmation:"forged"})})).status,400);
    await beforeCandidate?.();
    identity = candidate;
    response = await browser(issuer+"/account/link",{method:"POST",headers:{origin:issuer},body:new URLSearchParams({confirmation})});
    assert.equal((await browser(issuer+"/account/link",{method:"POST",headers:{origin:issuer},body:new URLSearchParams({confirmation})})).status,400);
    if (pauseAtCandidate) return prepareCode(response);
    response = await codeLogin(response);
    return {status:response.status,text:await response.text(),steps:[{path:"/login/complete",status:response.status}]};
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
    mail,
    codeLogin,
    nativeLogin,
    subjectFor,
    advanceLoginWindow,
    addressFor,
    knowledgeDirectory: root+"/releases",
    logPath,
    store,
    authenticate: (token) => boundary.authenticate({ headers: { authorization: "Bearer " + token } }),
    login,
    link,
    rpc,
    tool,
    config,
    controlConfig,
    browser,
    interactions,
    root,
    cert,
    databaseUrl,
    async setEmail(value) {
      if (!value.email || value.email === addressFor()) return;
      const current = identity, candidate = "address-" + value.email;
      addresses.set(candidate,value.email);
      const result = await link(current,candidate);
      assert.equal(result.status,200,result.text);
      identity = candidate;
      jar.get(issuer)?.delete("__Host-scoat-session");
    },
    setIdentity(value) {
      jar.get(issuer)?.delete("__Host-scoat-session");
      identity = value;
    },
    async restart() {
      await stopService();
      await startService();
    },
    async close() {
      await stopService();
      await close(mailServer);
      await store.close();
      await admin.query("DROP SCHEMA " + schema + " CASCADE");
      await admin.end();
      log.end();
      setDefaultCACertificates(originalCAs);
      await rm(root, { recursive: true, force: true });
    },
  };
}
