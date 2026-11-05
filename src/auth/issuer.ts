import { begin } from "../db/lineage.js";
import { ControlCodec, intentSchema, actionSchema } from "../controls/codec.js";
import { Hunts } from "../hunt/index.js";
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
import { publicClient, RegisteredClients, registerClient } from "./registration.js";
import { linkIdentity } from "./link.js";
import type { Agent, Id } from "../domain.js";
import { UnknownIdentity, resolveIdentity } from "./identity.js";
import { WatchRefusal, maskAddress, watchLimits, watchRefusalText, watchUrl } from "../memory/watches.js";
import type { WatchRefusalReason, Watches } from "../memory/watches.js";
import { watchTargetPence } from "../memory/contracts.js";
import { cleanShopUrl, observationSchema, watchTargetSchema } from "../delivery/index.js";

const accountScope = z.strictObject({
  account: z.uuid().brand<"AccountId">(),
  incarnation: z.uuid().brand<"Incarnation">(),
});
const contextSchema = z.discriminatedUnion("stage", [
  z.strictObject({stage:z.literal("control"),account:z.string(),intent:intentSchema}),
  z.strictObject({ stage: z.literal("enroll-confirm"), issuer: z.string(), subject: z.string().max(4096), uid: z.string() }),
  z.strictObject({ stage: z.literal("erase") }),
  z.strictObject({ stage: z.literal("erase-confirm"), target: accountScope, status: z.string() }),
  z.strictObject({ stage: z.literal("memory"), account: z.uuid(), key: z.string().min(1).max(128) }),
  z.strictObject({ stage: z.literal("memory-confirm"), target: accountScope, key: z.string().min(1).max(128) }),
  z.strictObject({ stage: z.literal("login"), uid: z.string() }),
  z.strictObject({ stage: z.literal("watch"), account: z.uuid(), hunt: z.string().min(1).max(128) }),
  z.strictObject({ stage: z.literal("watch-confirm"), target: accountScope, hunt: z.string().min(1).max(128), address: z.email().max(254), expectedRecipient: z.uuid().nullable(), moveRecipient: z.boolean(), watchTarget: watchTargetSchema, observation: observationSchema, observedAt: z.number().int() }),
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
const escapeHtml = (value: string) => value.replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function browserCookie(req: IncomingMessage) {
  return req.headers.cookie?.split("; ").find(value => value.startsWith("__Host-scoat-flow="))?.slice(18);
}
const watchHeaders = { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", "referrer-policy": "same-origin", "cache-control": "no-store" } as const;
const pounds = (pence: number) => "GBP " + (pence / 100).toFixed(2);
function watchRefusalPage(reason: WatchRefusalReason, retry: string | null, correction: Readonly<{ confirmation: string; moveRecipient: boolean }> | null = null) {
  if (reason === "invalid-target" && correction) return `<title>Correct your watch target</title><h1>Correct your watch target</h1><p>${escapeHtml(watchRefusalText[reason])}</p><p>Your recipient choice is unchanged.</p><form method="post" action="/account/watch"><input type="hidden" name="confirmation" value="${escapeHtml(correction.confirmation)}"><input type="hidden" name="decision" value="watch">${correction.moveRecipient ? '<input type="hidden" name="recipient" value="move">' : ""}<label>Your target delivered price (GBP)<input name="target" inputmode="decimal" required pattern="[0-9]{1,6}(\\.[0-9]{1,2})?" maxlength="16"></label><button>Confirm price watch</button></form>`;
  const recovery = reason === "already-watching" || reason === "watch-limit" ? "Stop a watch from the link in its alert email or ask your agent to unwatch it, then start again." : reason === "service-unconfigured" || reason === "unfinished" || reason === "no-exact-supported-variant" || reason === "ambiguous-variant" ? "No price watch can start for this hunt." : "";
  const again = retry ? `<p><a href="${escapeHtml(retry)}">Start again with a fresh public price</a></p>` : "<p>Choose Watch price again from your hunt card or hunt text to start with a fresh public price.</p>";
  return `<title>Price watch not started</title><h1>Price watch not started</h1><p>${escapeHtml(watchRefusalText[reason])}</p>${recovery ? `<p>${escapeHtml(recovery)}</p>` : ""}${again}`;
}
function targetPence(value: string) {
 const amount = z.string().regex(/^[0-9]{1,6}(\.[0-9]{1,2})?$/).safeParse(value);
 if (!amount.success) throw new WatchRefusal("invalid-target");
 const [whole = "", fraction = ""] = amount.data.split(".");
 const pence = watchTargetPence.safeParse(Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
 if (!pence.success) throw new WatchRefusal("invalid-target");
 return pence.data;
}
async function oneClick(req: IncomingMessage) {
  const type = req.headers["content-type"] ?? "";
  const media = type.split(";")[0]?.trim().toLowerCase();
  if (media !== "application/x-www-form-urlencoded" && media !== "multipart/form-data") throw new Error("Unsubscribe requires a form POST");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = z.instanceof(Buffer).parse(chunk);
    size += part.length;
    if (size > 4096) throw new Error("Unsubscribe body too large");
    chunks.push(part);
  }
  const body = Buffer.concat(chunks);
  const entries = media === "multipart/form-data"
    ? [...(await new Request("https://unsubscribe.invalid/", { method: "POST", headers: { "content-type": type }, body }).formData()).entries()]
    : [...new URLSearchParams(body.toString("utf8")).entries()];
  const [entry] = entries;
  if (entries.length !== 1 || entry?.[0] !== "List-Unsubscribe" || entry[1] !== "One-Click") throw new Error("Invalid unsubscribe body");
}
async function form(req: IncomingMessage) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw new Error("Body too large");
  }
  return new URLSearchParams(body);
}
export async function createIssuer(raw: unknown, pool: pg.Pool, controls?: {codec:ControlCodec; hunts:Hunts}, watches?: Watches) {
  const config = authConfigSchema.parse(raw);
  const issuer = new URL(config.issuer).origin;
  if (watches && watches.issuer !== issuer) throw new Error("Watch unsubscribe origin must equal the authorization issuer origin");
  const resource = issuer + "/mcp";
  const upstream = await oidc.discovery(
    new URL(config.upstreamIssuer),
    config.upstreamClientId,
    config.upstreamClientSecret,
  );
  const clients = config.clients.map(publicClient);
  const registration = config.registrationClientId ? new RegisteredClients(config) : undefined;
  const provider = new Provider(issuer, {
    adapter: model => model === "Client" && registration ? registration.adapter() : postgresAdapter(pool)(model),
    jwks: config.jwks,
    cookies: { keys: config.cookieKeys },
    clients,
    discovery: registration ? { registration_endpoint: issuer + "/reg" } : {},
    responseTypes: ["code"],
    clientAuthMethods: ["none"],
    scopes: ["openid", "offline_access"],
    rotateRefreshToken: true,
    extraParams: {
      state: (ctx, value) => {
        if (!value || ctx.oidc.params?.resource !== resource || ctx.oidc.params?.code_challenge_method !== "S256")
          throw new errors.InvalidRequest("State, resource and PKCE S256 required");
      },
    },
    features: {
      registration: { enabled: false },
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
            scope: "scoat:read scoat:write offline_access",
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
      Grant: 2592000,
      RefreshToken: 2592000,
      IdToken: 900,
      Interaction: 300,
      Session: 2592000,
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
      scope: context.stage === "watch" ? "openid email" : "openid",
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
    if (url.pathname === "/reg" && registration) return registerClient(req, res, registration);
    if (url.pathname === "/account/enroll" && req.method === "POST") {
      if (req.headers.origin !== issuer) throw new Error("Same origin required");
      const submitted = await form(req), confirmation = submitted.get("confirmation");
      if (!confirmation || submitted.get("decision") !== "enroll") throw new Error("Explicit enrollment required");
      const client = await pool.connect();
      let uid: string;
      let account: string;
      try {
        await begin(client);
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
    if (url.pathname === "/account/control") {
      if (!controls) throw new Error("Browser controls unavailable");
      res.setHeader("referrer-policy","same-origin");
      res.setHeader("content-security-policy","default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
      if(req.method === "GET") {
        const intent=controls.codec.readIntent(z.string().parse(url.searchParams.get("intent")));
        await upstreamRedirect(res,{stage:"control",account:intent.account,intent});
        return;
      }
      if(req.method !== "POST" || req.headers.origin !== issuer || req.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded") throw new Error("Invalid control request");
      const submitted=await form(req);
      const fields=z.strictObject({confirmation:z.string().max(4096),action:z.string().max(512),csrf:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).parse(Object.fromEntries(submitted));
      if([...submitted.keys()].length!==3) throw new Error("Duplicate form fields");
      if(controls.codec.nonce(fields.confirmation)!==fields.csrf) throw new Error("Invalid control nonce");
      const cookies=req.headers.cookie?.split(/;\s*/).filter(value=>value.startsWith("__Host-scoat-control-"+fields.csrf+"="));
      if(cookies?.length!==1) throw new Error("Missing control cookie");
      const browser=cookies[0]?.split("=")[1];
      if(!browser) throw new Error("Missing browser secret");
      const confirmed=controls.codec.verify(fields.confirmation,browser,JSON.parse(fields.action));
      const result=await controls.hunts.control({confirmed});
      res.writeHead(result.ok ? 200 : 403,{"content-type":"application/json"});
      res.end(JSON.stringify(result));
      return;
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

    if (url.pathname === "/account/watch") {
      if (!watches?.available) {
        res.writeHead(503, watchHeaders);
        res.end(watchRefusalPage("service-unconfigured", null));
        return;
      }
      if (req.method === "GET") {
        await upstreamRedirect(res, { stage: "watch", account: z.uuid().parse(url.searchParams.get("account")), hunt: z.string().min(1).max(128).parse(url.searchParams.get("hunt")) });
        return;
      }
      if (req.method !== "POST" || req.headers.origin !== issuer || req.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded") throw new Error("Explicit same-origin confirmation required");
      const submitted = await form(req);
      const fields = z.strictObject({ confirmation: z.string().min(1).max(128), decision: z.literal("watch"), target: z.string().max(16), recipient: z.literal("move").optional() }).parse(Object.fromEntries(submitted));
      if ([...submitted.keys()].length !== Object.keys(fields).length) throw new Error("Duplicate form fields");
      let retry: string | null = null;
      try {
        const pence = targetPence(fields.target);
        const activated = await retryTransaction(pool, async client => {
          const pending = (await client.query("SELECT data FROM oauth_browser_flows WHERE state=$1 AND expires_at>now() FOR UPDATE", [digest(fields.confirmation)])).rows[0];
          if (!pending) throw new WatchRefusal("expired");
          const flow = flowSchema.parse(pending.data), browser = browserCookie(req);
          if (!browser || digest(browser) !== flow.browser || flow.context.stage !== "watch-confirm") throw new Error("Invalid watch confirmation");
          const context = flow.context, observation = context.observation;
          if (observation.kind !== "comparable") throw new Error("Invalid watch confirmation");
          retry = watchUrl(issuer, context.target.account, context.hunt);
          if (context.moveRecipient !== (fields.recipient === "move")) throw new WatchRefusal("recipient-changed");
          const consumed = await client.query("DELETE FROM oauth_browser_flows WHERE state=$1 RETURNING state", [digest(fields.confirmation)]);
          if (!consumed.rowCount) throw new WatchRefusal("expired");
          return watches.activate(client, { scope: context.target, hunt: context.hunt, target: context.watchTarget, targetPence: pence, observation, observedAt: context.observedAt, address: context.address, expectedRecipient: context.expectedRecipient, moveRecipient: context.moveRecipient });
        });
        res.writeHead(200, watchHeaders);
        res.end(`<title>Watch active</title><h1>Watch active</h1><p>Watch ${escapeHtml(activated.watch)} checks the public delivered price daily. An alert needs a price at or below ${pounds(activated.targetPence)} and strictly below the ${pounds(activated.baselinePence)} baseline.</p>${activated.movedWatches ? `<p>Alerts for your ${activated.movedWatches} other active ${activated.movedWatches === 1 ? "watch" : "watches"} now go to the same verified address.</p>` : ""}<p>Every alert email has a one-step unsubscribe link.</p>`);
      } catch (error) {
        if (!(error instanceof WatchRefusal)) throw error;
        res.writeHead(409, watchHeaders);
        res.end(watchRefusalPage(error.reason, retry, { confirmation: fields.confirmation, moveRecipient: fields.recipient === "move" }));
      }
      return;
    }
    if (url.pathname === "/watch/unsubscribe") {
      if (!watches) throw new Error("Watches unavailable");
      const token = z.string().min(1).max(512).regex(/^[A-Za-z0-9_.-]+$/).parse(url.searchParams.get("token"));
      if (req.method === "GET") {
        res.writeHead(200, watchHeaders);
        res.end(`<title>Stop Scoat watch</title><h1>Stop this price watch?</h1><p>Stopping cancels future checks and any alert not yet submitted. An alert already handed to the mail provider may still arrive.</p><form method="post" action="/watch/unsubscribe?token=${escapeHtml(token)}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button>Stop watching</button></form>`);
        return;
      }
      if (req.method !== "POST") throw new Error("Unsubscribe requires a form POST");
      await oneClick(req);
      const result = await watches.unsubscribe(token);
      res.writeHead(200, watchHeaders);
      res.end(result.kind === "unsubscribed" ? `<title>Watch stopped</title><h1>Watch stopped</h1><p>No new checks or alerts will start.${result.mayStillArrive ? " One alert was already handed to the mail provider and may still arrive." : ""}</p>` : `<title>Watch not active</title><h1>This watch is not active</h1><p>No further alerts will start from this link.</p>`);
      return;
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
        await begin(client);
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
      const rows = await retryTransaction(pool, client => client.query(
        "DELETE FROM oauth_browser_flows WHERE state=$1 AND expires_at>now() RETURNING data",
        [digest(confirmation)],
      ));
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
        grant.addOIDCScope(String(details.params.scope ?? "").split(" ").filter(value => ["openid", "offline_access"].includes(value)).join(" "));
        const requested = String(details.params.scope ?? "")
          .split(" ")
          .filter((value) => ["scoat:read", "scoat:write", "offline_access"].includes(value));
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
      const flows = await retryTransaction(pool, client => client.query(
        "DELETE FROM oauth_browser_flows WHERE state=$1 AND expires_at>now() RETURNING data",
        [digest(state)],
      ));
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
      if(flow.context.stage === "control") {
        if(!controls) throw new Error("Browser controls unavailable");
        const actual=await resolveIdentity(pool,upstream.serverMetadata().issuer,claims.sub);
        const intent=flow.context.intent;
        if(actual.account!==intent.account || actual.incarnation!==intent.incarnation) throw new Error("Control requires the same account and incarnation");
        const issued=await retryTransaction(pool,async client=>{
          if(!(await client.query("SELECT 1 FROM hunt_accounts WHERE account=$1 AND incarnation=$2 AND NOT erased FOR SHARE",[actual.account,actual.incarnation])).rowCount) throw new Error("Inactive control owner");
          const hunt=(await client.query("SELECT snapshot IS NOT NULL AS finished,data->>'stopRequestedAt' AS stopped FROM durable_hunts WHERE account=$1 AND incarnation=$2 AND id=$3",[actual.account,actual.incarnation,intent.hunt])).rows[0];
          if(!hunt) throw new Error("Unknown control hunt");
          const databaseTime=z.coerce.number().parse((await client.query("SELECT extract(epoch FROM clock_timestamp())*1000 AS milliseconds")).rows[0]?.milliseconds);
          const actions=intent.action.kind === "hub"
            ? [actionSchema.parse({kind:"stop"}),...(await client.query("SELECT id FROM hunt_rows WHERE account=$1 AND incarnation=$2 AND hunt=$3 ORDER BY id",[actual.account,actual.incarnation,intent.hunt])).rows.map(row=>actionSchema.parse({kind:"skip",row:row.id}))]
            : [intent.action];
          const forms=actions.map(action=>{
            const browser=randomBytes(32).toString("base64url");
            return {...controls.codec.issue({...intent,action},browser,databaseTime),browser,action};
          });
          return {forms,finished:hunt.finished === true,state:hunt.finished ? "Finished; its saved result stays unchanged." : hunt.stopped ? "Stop was already requested." : "Hunt is open."};
        });
        const escape=(value:string)=>value.replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;").replaceAll(">","&gt;");
        res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"same-origin","content-security-policy":"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'","set-cookie":issued.forms.map(form=>`__Host-scoat-control-${form.nonce}=${form.browser}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=180`)});
        res.end(`<title>Confirm Scoat control</title><p>Hunt ${escape(intent.hunt)}. ${issued.state}</p><p>Stop prevents new accepted discoveries. It does not cancel your host or agent.</p>${watches?.available && issued.finished ? `<p><a href="${escape(watchUrl(issuer,actual.account,intent.hunt))}">Watch this finished hunt's price</a></p>` : ""}`+issued.forms.map(form=>{
          const label=form.action.kind === "stop" ? "Stop accepting new discoveries" : "Skip row "+form.action.row;
          return `<form method="post" action="/account/control"><input type="hidden" name="confirmation" value="${form.token}"><input type="hidden" name="csrf" value="${form.nonce}"><input type="hidden" name="action" value="${escape(JSON.stringify(form.action))}"><button>${escape(label)}</button></form>`;
        }).join(""));
        return;
      }
      if (flow.context.stage === "erase") {
        const target = await resolveIdentity(pool,upstream.serverMetadata().issuer,claims.sub);
        const client = await pool.connect();
        try {
          await begin(client);
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
      if (flow.context.stage === "watch") {
        if (!watches) throw new Error("Watches unavailable");
        const target = await resolveIdentity(pool,upstream.serverMetadata().issuer,claims.sub);
        if (target.account !== flow.context.account) throw new Error("Same account required");
        const hunt = flow.context.hunt;
        const retry = watchUrl(issuer, target.account, hunt);
        const address = claims.email_verified === true ? z.email().max(254).safeParse(claims.email) : null;
        if (!address?.success) {
          res.writeHead(403, watchHeaders);
          res.end(`<title>Verified email required</title><h1>Verified email required</h1><p>Your sign-in provider did not confirm a verified email address for this account. No watch was activated and no email will be sent.</p>`);
          return;
        }
        const prepared = await watches.prepare(target, hunt);
        if (prepared.kind !== "ready") {
          res.writeHead(409, watchHeaders);
          res.end(watchRefusalPage(prepared.reason, null));
          return;
        }
        const observation = await watches.observe(prepared.target);
        if (observation.kind !== "comparable") {
          res.writeHead(200, watchHeaders);
          res.end(`<title>Watch unavailable</title><h1>Watch cannot start</h1><p>The public price for ${escapeHtml(cleanShopUrl(prepared.target))} is unknown (${escapeHtml(observation.reason)}). No active price promise was created and no email will be sent.</p><p><a href="${escapeHtml(retry)}">Try again later</a></p>`);
          return;
        }
        const moving = prepared.recipient !== null && prepared.recipient.address !== address.data;
        const moveRecipient = moving && prepared.otherActive > 0;
        const confirmation = randomBytes(32).toString("base64url");
        const observedAt = await retryTransaction(pool, async client => {
          const now = z.coerce.number().parse((await client.query("SELECT floor(extract(epoch FROM clock_timestamp())*1000) AS milliseconds")).rows[0]?.milliseconds);
          await writeBrowserFlow(client,digest(confirmation),{ ...flow, context: { stage: "watch-confirm", target, hunt, address: address.data, expectedRecipient: prepared.recipient?.revision ?? null, moveRecipient, watchTarget: prepared.target, observation, observedAt: now } });
          return now;
        });
        const masked = escapeHtml(maskAddress(address.data));
        const recipient = moveRecipient && prepared.recipient
          ? `<dd>${masked} (verified by your sign-in provider)</dd></dl><p><strong>Your sign-in provider verified a different address. Your ${prepared.otherActive} other active ${prepared.otherActive === 1 ? "watch alerts" : "watches alert"} ${escapeHtml(maskAddress(prepared.recipient.address))} now.</strong> Scoat sends every watch alert for this account to one verified address. Starting this watch moves alerts for all ${prepared.otherActive + 1} watches to ${masked}; an alert already handed to the mail provider may still arrive at the old address.</p><p><label><input type="checkbox" name="recipient" value="move" form="watch-confirm" required> Send alerts for all my watches to ${masked}</label></p>`
          : `<dd>${masked} (verified by your sign-in provider)${moving && prepared.recipient ? `; replaces ${escapeHtml(maskAddress(prepared.recipient.address))}, which has no other active watch` : ""}</dd></dl>`;
        const suggested = prepared.suggestedPence === null ? "" : (prepared.suggestedPence / 100).toFixed(2);
        res.writeHead(200, watchHeaders);
        res.end(`<title>Confirm Scoat price watch</title><h1>Confirm price watch</h1><dl><dt>Item</dt><dd>Raspberry Pi 5, SKU ${escapeHtml(prepared.target.sku)}, variant ${prepared.target.variant}, quantity one</dd><dt>Seller</dt><dd>${escapeHtml(prepared.target.seller)}: <a href="${escapeHtml(cleanShopUrl(prepared.target))}">${escapeHtml(cleanShopUrl(prepared.target))}</a></dd><dt>Observed</dt><dd>${new Date(observedAt).toISOString()} from the public product and delivery pages</dd><dt>Item price</dt><dd>${pounds(observation.itemPence)}</dd><dt>Delivery</dt><dd>${pounds(observation.deliveryPence)} UK Royal Mail 1st Class, non-member, non-lithium</dd><dt>Public delivered baseline</dt><dd>${pounds(observation.amountPence)}</dd><dt>Alerts go to</dt>${recipient}<p>Scoat checks once a day for up to ${watchLimits.days} days and emails when the delivered public price is at or below your target and strictly below the baseline and any earlier alert. Student, coupon, cashback, rewards and member prices never count. At most ${watchLimits.active} active watches per account. Confirm within ${watchLimits.freshObservationSeconds / 60} minutes or start again.</p><form id="watch-confirm" method="post" action="/account/watch"><input type="hidden" name="confirmation" value="${confirmation}"><p><label for="watch-target">Your target delivered price (GBP)</label> <input id="watch-target" name="target" inputmode="decimal" required pattern="[0-9]{1,6}([.][0-9]{1,2})?" value="${suggested}"></p><button name="decision" value="watch">Start watching</button></form>`);
        return;
      }
      if (flow.context.stage === "memory") {
        const target = await resolveIdentity(pool,upstream.serverMetadata().issuer,claims.sub);
        if (target.account !== flow.context.account) throw new Error("Same account required");
        const client = await pool.connect();
        try {
          await begin(client);
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
          await begin(client);
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
