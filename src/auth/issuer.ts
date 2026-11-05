import { retryTransaction } from "../db/transaction.js";
import { persistBrowserFlow, writeBrowserFlow } from "./flows.js";
import { eraseAccount } from "../accounts/erasure.js";
import { randomUUID, randomBytes, createHash, createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import Provider, { errors } from "oidc-provider";
import * as oidc from "openid-client";
import type pg from "pg";
import { z } from "zod";
import { postgresAdapter } from "./adapter.js";
import { authConfigSchema } from "./config.js";
import { linkIdentity } from "./link.js";
import type { Agent, Id } from "../domain.js";
import { UnknownIdentity, resolveIdentity } from "./identity.js";

const accountScope = z.strictObject({
  account: z.uuid().brand<"AccountId">(),
  incarnation: z.uuid().brand<"Incarnation">(),
});
const contextSchema = z.discriminatedUnion("stage", [
  z.strictObject({ stage: z.literal("enroll-confirm"), issuer: z.string(), subject: z.string().max(4096), uid: z.string() }),
  z.strictObject({ stage: z.literal("erase") }),
  z.strictObject({ stage: z.literal("erase-confirm"), target: accountScope, status: z.string() }),
  z.strictObject({ stage: z.literal("memory"), account: z.uuid(), key: z.string().min(1).max(128) }),
  z.strictObject({ stage: z.literal("memory-confirm"), target: accountScope, key: z.string().min(1).max(128) }),
  z.strictObject({ stage: z.literal("login"), uid: z.string() }),
  z.strictObject({ stage: z.literal("link-current") }),
  z.strictObject({ stage: z.literal("link-confirm"), target: accountScope }),
  z.strictObject({ stage: z.literal("link-candidate"), target: accountScope, startedAt: z.number().int() }),
]);
const flowSchema = z.strictObject({
  initiatedAt: z.number().int(), verifier: z.string(), nonce: z.string(), browser: z.string(), context: contextSchema,
});
const verified = Symbol("verified OAuth principal");
export type Principal = Readonly<{
  agent: Agent;
  session: Id<"OAuthSessionId">;
  scopes: ReadonlySet<string>;
  [verified]: true;
}>;
export class InvalidCredential extends Error {}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function browserCookie(req: IncomingMessage) {
  return req.headers.cookie?.split("; ").find(value => value.startsWith("__Host-scoat-flow="))?.slice(18);
}
async function form(req: IncomingMessage) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw new Error("Body too large");
  }
  return new URLSearchParams(body);
}
export async function createIssuer(raw: unknown, pool: pg.Pool) {
  const config = authConfigSchema.parse(raw);
  const issuer = new URL(config.issuer).origin;
  const resource = issuer + "/mcp";
  const upstream = await oidc.discovery(
    new URL(config.upstreamIssuer),
    config.upstreamClientId,
    config.upstreamClientSecret,
  );
  const provider = new Provider(issuer, {
    adapter: postgresAdapter(pool),
    jwks: config.jwks,
    cookies: { keys: config.cookieKeys },
    clients: config.clients.map((client) => ({
      ...client,
      response_types: ["code"],
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "none",
      subject_type: "public",
    })),
    responseTypes: ["code"],
    scopes: ["openid"],
    extraParams: {
      state: (ctx, value) => {
        if (!value || ctx.oidc.params?.resource !== resource || ctx.oidc.params?.code_challenge_method !== "S256")
          throw new errors.InvalidRequest("State, resource and PKCE S256 required");
      },
    },
    features: {
      dPoP: { enabled: false },
      pushedAuthorizationRequests: { enabled: false },
      userinfo: { enabled: false },
      rpInitiatedLogout: { enabled: false },
      devInteractions: { enabled: false },
      revocation: {
        enabled: true,
        allowedPolicy: (_ctx, client, token) =>
          client.clientId === token.clientId,
      },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => { throw new errors.InvalidTarget("Explicit resource required"); },
        getResourceServerInfo: (_ctx, value) => {
          if (value !== resource) throw new errors.InvalidTarget("Invalid resource");
          return {
            scope: "scoat:read scoat:write",
            audience: resource,
            accessTokenFormat: "opaque",
            accessTokenTTL: 900,
          };
        },
      },
    },
    pkce: { required: () => true },
    ttl: {
      AccessToken: 900,
      AuthorizationCode: 60,
      Grant: 3600,
      IdToken: 900,
      Interaction: 300,
      Session: 3600,
    },
    interactions: {
      url: (_ctx, interaction) => `/interaction/${interaction.uid}`,
    },
    findAccount: async (_ctx, accountId) => {
      const active = await pool.query("SELECT 1 FROM hunt_accounts WHERE account=$1 AND NOT erased",[accountId]);
      if (!active.rowCount) return undefined;
      return { accountId, claims: () => ({ sub: accountId }) };
    },
  });
  async function authenticate(req: IncomingMessage) {
    const authorization = z.string().max(4096).regex(/^Bearer [A-Za-z0-9._~-]+$/).safeParse(req.headers.authorization);
    if (!authorization.success) throw new InvalidCredential("Invalid bearer credential");
    const token = await provider.AccessToken.find(authorization.data.slice(7));
    if (
      !token ||
      token.isExpired ||
      token.aud !== resource ||
      token.isSenderConstrained() ||
      !token.scope?.split(" ").includes("scoat:read") ||
      !token.sessionUid
    )
      throw new InvalidCredential("Invalid access token");
    const session = await provider.Session.findByUid(token.sessionUid);
    const grant = await provider.Grant.find(token.grantId);
    if (
      !session ||
      session.isExpired ||
      session.accountId !== token.accountId ||
      !grant ||
      grant.isExpired ||
      grant.accountId !== token.accountId ||
      grant.clientId !== token.clientId
    )
      throw new InvalidCredential("Revoked OAuth session or grant");
    const result = await pool.query(
      "SELECT account,incarnation FROM oauth_identities WHERE account=$1",
      [token.accountId],
    );
    if (!result.rowCount) throw new InvalidCredential("Identity unavailable");
    const account = accountScope.parse(result.rows[0]);
    const active = await pool.query(
      "SELECT 1 FROM hunt_accounts WHERE account=$1 AND incarnation=$2 AND NOT erased",
      [account.account, account.incarnation],
    );
    if (!active.rowCount) throw new InvalidCredential("Inactive account incarnation");
    return {
      agent: { ...account, kind: "agent", client: z.string().min(1).parse(token.clientId) },
      session: z.string().min(1).brand<"OAuthSessionId">().parse(token.sessionUid),
      scopes: new Set(token.scope.split(" ")),
      [verified]: true,
    } satisfies Principal;
  }
  async function upstreamRedirect(
    res: ServerResponse,
    context: z.infer<typeof contextSchema>,
  ) {
    const state = oidc.randomState(),
      verifier = oidc.randomPKCECodeVerifier(),
      nonce = oidc.randomNonce(),
      browser = randomBytes(32).toString("base64url");
    await persistBrowserFlow(pool,digest(state),{ verifier, nonce, browser: digest(browser), context });
    const destination = oidc.buildAuthorizationUrl(upstream, {
      redirect_uri: issuer + "/upstream/callback",
      scope: "openid",
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      prompt: "login",
      max_age: "0",
    });
    res.writeHead(303, {
      location: destination.href,
      "set-cookie": `__Host-scoat-flow=${browser}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=300`,
    });
    res.end();
  }
  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", issuer);
    if (url.pathname === "/account/enroll" && req.method === "POST") {
      if (req.headers.origin !== issuer) throw new Error("Same origin required");
      const submitted = await form(req), confirmation = submitted.get("confirmation");
      if (!confirmation || submitted.get("decision") !== "enroll") throw new Error("Explicit enrollment required");
      const client = await pool.connect();
      let uid: string;
      let account: string;
      try {
        await client.query("BEGIN");
        const row = (await client.query("SELECT data FROM oauth_browser_flows WHERE state=$1 AND expires_at>now()",[digest(confirmation)])).rows[0];
        const flow = flowSchema.parse(row?.data), browser = browserCookie(req);
        if (!browser || digest(browser) !== flow.browser || flow.context.stage !== "enroll-confirm") throw new Error("Invalid enrollment confirmation");
        const context = flow.context;
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[JSON.stringify([context.issuer,context.subject])]);
        const pseudonym = createHmac("sha256",config.lifecycleKey).update(JSON.stringify([context.issuer,context.subject])).digest("hex");
        const erased = await client.query("SELECT 1 FROM account_suppression WHERE subject_digest=$1 AND erased_at>=to_timestamp($2/1000.0)",[pseudonym,flow.initiatedAt]);
        if (erased.rowCount) throw new Error("Enrollment predates erasure; start a fresh login");
        const consumed = await client.query("DELETE FROM oauth_browser_flows WHERE state=$1 AND expires_at>now() RETURNING state",[digest(confirmation)]);
        if (!consumed.rowCount) throw new Error("Enrollment already used");
        const existing = await client.query("SELECT 1 FROM oauth_identities WHERE issuer=$1 AND subject=$2",[context.issuer,context.subject]);
        if (existing.rowCount) throw new Error("Identity already enrolled");
        account = randomUUID(); const incarnation = randomUUID(); uid = context.uid;
        await client.query("INSERT INTO hunt_accounts(account,incarnation) VALUES($1,$2)",[account,incarnation]);
        await client.query("INSERT INTO oauth_identities(issuer,subject,account,incarnation) VALUES($1,$2,$3,$4)",[context.issuer,context.subject,account,incarnation]);
        await client.query("COMMIT");
      } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      const interaction = await provider.Interaction.find(uid);
      if (!interaction) throw new Error("Interaction expired; sign in again");
      interaction.result = { login: { accountId: account, ts: Math.floor(Date.now()/1000) } };
      await interaction.save(60);
      res.writeHead(303,{location:interaction.returnTo}); res.end(); return;
    }
    if (url.pathname === "/account/erase-status" && req.method === "GET") {
      res.writeHead(200,{"content-type":"text/html; charset=utf-8","content-security-policy":"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'","cache-control":"no-store","referrer-policy":"same-origin"});
      res.end(`<title>Check account erasure</title><p>Enter the status secret saved before erasure. Completed results remain available for 24 hours.</p><form method="post" action="/account/erase-status"><label>Status secret <input type="password" name="status" maxlength="128" required autocomplete="off"></label><button>Check erasure result</button></form>`);
      return;
    }
    if (url.pathname === "/account/erase-status" && req.method === "POST") {
      if (req.headers.origin !== issuer) throw new Error("Same origin required");
      const status = (await form(req)).get("status");
      if (!status || status.length > 128) throw new Error("Invalid status capability");
      const row = (await pool.query("SELECT operation,completed_at,policy FROM erase_status WHERE digest=$1 AND expires_at>now()", [digest(status)])).rows[0];
      if (!row) throw new Error("Status unavailable");
      res.writeHead(200,{"content-type":"application/json","cache-control":"no-store","referrer-policy":"no-referrer"}); res.end(JSON.stringify(row)); return;
    }
    if (url.pathname === "/account/erase") {
      if (req.method === "GET") { await upstreamRedirect(res,{stage:"erase"}); return; }
      if (req.method !== "POST" || req.headers.origin !== issuer) throw new Error("Same-origin POST required");
      const submitted = await form(req);
      const confirmation = submitted.get("confirmation");
      if (!confirmation || submitted.get("decision") !== "erase") throw new Error("Explicit erasure required");
      const receipt = await retryTransaction(pool,async client => {
        const row = (await client.query("SELECT data FROM oauth_browser_flows WHERE state=$1 AND expires_at>now()",[digest(confirmation)])).rows[0];
        const flow = flowSchema.parse(row?.data), browser = browserCookie(req);
        if (!browser || digest(browser) !== flow.browser || flow.context.stage !== "erase-confirm") throw new Error("Invalid erasure confirmation");
        return eraseAccount(client,flow.context.target,config.lifecycleKey,config.lifecycleKeyVersion,flow.context.status);
      });
      res.writeHead(200,{"content-type":"application/json"}); res.end(JSON.stringify(receipt)); return;
    }

    if (url.pathname === "/account/memory") {
      if (req.method === "GET") {
        await upstreamRedirect(res, { stage: "memory", account: z.uuid().parse(url.searchParams.get("account")), key: z.string().min(1).max(128).parse(url.searchParams.get("key")) });
        return;
      }
      if (req.method !== "POST" || req.headers.origin !== issuer) throw new Error("Explicit same-origin confirmation required");
      const submitted = await form(req);
      const confirmation = submitted.get("confirmation");
      if (!confirmation || submitted.get("decision") !== "allow") throw new Error("Explicit allow required");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const pending = (await client.query("SELECT data FROM oauth_browser_flows WHERE state=$1 AND expires_at>now()", [digest(confirmation)])).rows[0];
        const flow = flowSchema.parse(pending?.data);
        const browser = browserCookie(req);
        if (!browser || digest(browser) !== flow.browser || flow.context.stage !== "memory-confirm") throw new Error("Invalid confirmation");
        const target = flow.context.target;
        const active = await client.query("SELECT 1 FROM hunt_accounts WHERE account=$1 AND incarnation=$2 AND NOT erased FOR SHARE", [target.account,target.incarnation]);
        if (!active.rowCount) throw new Error("Inactive account incarnation");
        const consumed = await client.query("DELETE FROM oauth_browser_flows WHERE state=$1 AND expires_at>now() RETURNING state", [digest(confirmation)]);
        if (!consumed.rowCount) throw new Error("Confirmation already used");
        const approved = await client.query("UPDATE memory_commands SET approved=true WHERE account=$1 AND incarnation=$2 AND key=$3 AND command IS NOT NULL AND expires_at>now() AND outcome IS NULL RETURNING key", [target.account,target.incarnation,flow.context.key]);
        if (!approved.rowCount) throw new Error("Proposal unavailable");
        await client.query("COMMIT");
      } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      res.writeHead(200,{"content-type":"text/plain"}); res.end("Exact command approved. Resubmit it from the originating session."); return;
    }
    if (url.pathname === "/account/link") {
      if (req.method === "GET") {
        await upstreamRedirect(res, { stage: "link-current" });
        return;
      }
      if (req.method !== "POST" || req.headers.origin !== issuer) {
        res.writeHead(403);
        res.end();
        return;
      }
      const submitted = await form(req);
      const confirmation = submitted.get("confirmation");
      if (!confirmation) throw new Error("Missing confirmation");
      const rows = await pool.query(
        "DELETE FROM oauth_browser_flows WHERE state=$1 AND expires_at>now() RETURNING data",
        [digest(confirmation)],
      );
      const flow = flowSchema.parse(rows.rows[0]?.data);
      const browser = browserCookie(req);
      if (!browser || digest(browser) !== flow.browser || flow.context.stage !== "link-confirm")
        throw new Error("Invalid link confirmation");
      await upstreamRedirect(res, { stage: "link-candidate", target: flow.context.target, startedAt: flow.initiatedAt });
      return;
    }
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resource,
          authorization_servers: [issuer],
          scopes_supported: ["scoat:read", "scoat:write"],
          bearer_methods_supported: ["header"],
        }),
      );
      return;
    }
    if (url.pathname.startsWith("/interaction/")) {
      const details = await provider.interactionDetails(req, res);
      if (details.prompt.name === "login" && req.method === "GET") {
        await upstreamRedirect(res, { stage: "login", uid: details.uid });
        return;
      }
      if (details.prompt.name === "consent" && details.session) {
        const csrf = createHmac("sha256", config.cookieKeys.join(":")).update(JSON.stringify([details.uid, details.session.uid])).digest("hex");
        if (req.method === "GET") {
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy":
              "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
            "cache-control": "no-store",
          });
          res.end(
            `<title>Scoat consent</title><p>Allow registered client ${String(details.params.client_id)} access to Scoat hunts with scopes ${String(details.params.scope).replace(/[^A-Za-z0-9: _~-]/g, "")} ?</p><form method="post"><input type="hidden" name="csrf" value="${csrf}"><button name="decision" value="allow">Allow</button><button name="decision" value="deny">Deny</button></form>`,
          );
          return;
        }
        const submitted =
          req.method === "POST" ? await form(req) : new URLSearchParams();
        const decision = z.enum(["allow", "deny"]).safeParse(submitted.get("decision"));
        if (
          req.method !== "POST" ||
          req.headers.origin !== issuer ||
          submitted.get("csrf") !== csrf ||
          !decision.success
        ) {
          res.writeHead(403);
          res.end();
          return;
        }
        if (decision.data === "deny") {
          await provider.interactionFinished(
            req,
            res,
            { error: "access_denied", error_description: "Consent declined" },
            { mergeWithLastSubmission: false },
          );
          return;
        }
        const grant = details.grantId
          ? await provider.Grant.find(details.grantId)
          : new provider.Grant({
              accountId: details.session.accountId,
              clientId: String(details.params.client_id),
            });
        if (!grant) throw new Error("Missing consent grant");
        grant.addOIDCScope("openid");
        const requested = String(details.params.scope ?? "")
          .split(" ")
          .filter((value) => ["scoat:read", "scoat:write"].includes(value));
        grant.addResourceScope(resource, requested);
        await provider.interactionFinished(
          req,
          res,
          { consent: { grantId: await grant.save() } },
          { mergeWithLastSubmission: true },
        );
        return;
      }
      res.writeHead(400);
      res.end();
      return;
    }
    if (url.pathname === "/upstream/callback" && req.method === "GET") {
      const state = url.searchParams.get("state");
      if (!state) throw new Error("Missing state");
      const flows = await pool.query(
        "DELETE FROM oauth_browser_flows WHERE state=$1 AND expires_at>now() RETURNING data",
        [digest(state)],
      );
      const flow = flowSchema.parse(flows.rows[0]?.data);
      const browser = browserCookie(req);
      if (!browser || digest(browser) !== flow.browser)
        throw new Error("Browser binding mismatch");
      const tokens = await oidc.authorizationCodeGrant(upstream, url, {
        pkceCodeVerifier: flow.verifier,
        expectedState: state,
        expectedNonce: flow.nonce,
        maxAge: 0,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims || !Number.isSafeInteger(claims.auth_time) || Number(claims.auth_time)*1000 < flow.initiatedAt-60000 || Number(claims.auth_time)*1000 > Date.now()+60000) throw new Error("Fresh verified auth_time required");
      if (flow.context.stage === "erase") {
        const target = await resolveIdentity(pool,upstream.serverMetadata().issuer,claims.sub);
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const active = await client.query("SELECT 1 FROM hunt_accounts WHERE account=$1 AND incarnation=$2 AND NOT erased FOR SHARE",[target.account,target.incarnation]);
          if (!active.rowCount) throw new Error("Inactive account incarnation");
          const confirmation = randomBytes(32).toString("base64url"), status = randomBytes(32).toString("base64url");
          await client.query("INSERT INTO erase_status(digest,operation) VALUES($1,$2)",[digest(status),randomUUID()]);
          await writeBrowserFlow(client,digest(confirmation),{...flow,context:{stage:"erase-confirm",target,status:digest(status)}});
          await client.query("COMMIT");
          res.writeHead(200,{"content-type":"text/html; charset=utf-8","content-security-policy":"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'","cache-control":"no-store","referrer-policy":"same-origin"});
          res.end(`<title>Erase Scoat account</title><p>Erasure removes saved results, profiles, hunts and Scoat credentials. Pseudonymous suppression metadata remains 31 days; completion status remains 24 hours. Backup enforcement is an operational gate. Upstream identities and delivered mail are outside Scoat deletion.</p><p>Save this status secret before confirming: <code>${status}</code></p><p>If the response is lost, <a href="/account/erase-status">check the erasure result</a> with your saved secret.</p><form method="post" action="/account/erase"><input type="hidden" name="confirmation" value="${confirmation}"><button name="decision" value="erase">Erase this account</button></form>`); return;
        } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      }
      if (flow.context.stage === "memory") {
        const target = await resolveIdentity(pool,upstream.serverMetadata().issuer,claims.sub);
        if (target.account !== flow.context.account) throw new Error("Same account required");
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const active = await client.query("SELECT 1 FROM hunt_accounts WHERE account=$1 AND incarnation=$2 AND NOT erased FOR SHARE", [target.account,target.incarnation]);
          if (!active.rowCount) throw new Error("Inactive account incarnation");
          const command = (await client.query("SELECT command FROM memory_commands WHERE account=$1 AND incarnation=$2 AND key=$3 AND expires_at>now() AND command IS NOT NULL", [target.account,target.incarnation,flow.context.key])).rows[0];
          if (!command) throw new Error("Proposal unavailable");
          const confirmation = randomBytes(32).toString("base64url");
          await writeBrowserFlow(client,digest(confirmation),{ ...flow, context: { stage: "memory-confirm", target, key: flow.context.key } });
          await client.query("COMMIT");
          const display = JSON.stringify(command.command).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
          res.writeHead(200,{"content-type":"text/html; charset=utf-8","content-security-policy":"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});
          res.end(`<title>Confirm Memory command</title><pre>${display}</pre><form method="post" action="/account/memory"><input type="hidden" name="confirmation" value="${confirmation}"><button name="decision" value="allow">Approve exact command</button></form>`); return;
        } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      }
      if (flow.context.stage === "link-current") {
        const existing = await pool.query(
          "SELECT i.account,i.incarnation FROM oauth_identities i JOIN hunt_accounts a USING(account,incarnation) WHERE i.issuer=$1 AND i.subject=$2 AND NOT a.erased",
          [upstream.serverMetadata().issuer, claims.sub],
        );
        const target = accountScope.parse(existing.rows[0]);
        const confirmation = randomBytes(32).toString("base64url");
        await persistBrowserFlow(pool,digest(confirmation),{ ...flow, context: { stage: "link-confirm", target } });
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
          "cache-control": "no-store",
        });
        res.end(`<title>Link a Scoat identity</title><p>Keep this Scoat account and sign in with the identity you want to add. Accounts with existing hunts or other linked identities require a separate migration.</p><form method="post" action="/account/link"><input type="hidden" name="confirmation" value="${confirmation}"><button>Sign in with the identity to add</button></form>`);
        return;
      }
      if (flow.context.stage === "link-candidate") {
        await linkIdentity(
          pool,
          flow.context.target,
          upstream.serverMetadata().issuer,
          claims.sub,
          flow.context.startedAt,
          config.lifecycleKey,
        );
        res.writeHead(200, {
          "content-type": "text/plain",
          "set-cookie":
            "__Host-scoat-flow=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        });
        res.end(
          "Identity linked after both reauthentications. Sign in again to resume your account.",
        );
        return;
      }
      if (flow.context.stage !== "login") throw new Error("Invalid callback stage");
      let account;
      try { account = await resolveIdentity(pool,upstream.serverMetadata().issuer,claims.sub); }
      catch(error) {
        if (!(error instanceof UnknownIdentity)) throw error;
        const confirmation = randomBytes(32).toString("base64url");
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[JSON.stringify([upstream.serverMetadata().issuer,claims.sub])]);
          const existing = await client.query("SELECT 1 FROM oauth_identities WHERE issuer=$1 AND subject=$2",[upstream.serverMetadata().issuer,claims.sub]);
          if (existing.rowCount) throw new Error("Identity changed; start a fresh login");
          const subjectDigest = createHmac("sha256",config.lifecycleKey).update(JSON.stringify([upstream.serverMetadata().issuer,claims.sub])).digest("hex");
          const suppressed = await client.query("SELECT 1 FROM account_suppression WHERE subject_digest=$1 AND erased_at>=to_timestamp($2/1000.0)",[subjectDigest,flow.initiatedAt]);
          if (suppressed.rowCount) throw new Error("Callback predates erasure; start a fresh login");
          await writeBrowserFlow(client,digest(confirmation),{...flow,context:{stage:"enroll-confirm",issuer:upstream.serverMetadata().issuer,subject:claims.sub,uid:flow.context.uid}});
          await client.query("COMMIT");
        } catch(failure) { await client.query("ROLLBACK"); throw failure; } finally { client.release(); }
        res.writeHead(200,{"content-type":"text/html; charset=utf-8","content-security-policy":"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});
        res.end(`<title>Enroll in Scoat</title><p>Create a fresh Scoat account for this authenticated identity.</p><form method="post" action="/account/enroll"><input type="hidden" name="confirmation" value="${confirmation}"><button name="decision" value="enroll">Create account</button></form>`); return;
      }
      const interaction = await provider.Interaction.find(flow.context.uid);
      if (!interaction) throw new Error("Expired interaction");
      interaction.result = {
        login: {
          accountId: account.account,
          ts: Math.floor(Date.now() / 1000),
        },
      };
      await interaction.save(60);
      res.writeHead(303, {
        location: interaction.returnTo,
        "set-cookie":
          "__Host-scoat-flow=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      });
      res.end();
      return;
    }
    await provider.callback()(req, res);
  }
  return { provider, authenticate, route, issuer, resource };
}
