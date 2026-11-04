import { randomBytes, createHash, createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import Provider, { errors } from "oidc-provider";
import * as oidc from "openid-client";
import type pg from "pg";
import { z } from "zod";
import { postgresAdapter } from "./adapter.js";
import { authConfigSchema } from "./config.js";
import { linkIdentity } from "./link.js";
import type { Agent, Id } from "../domain.js";
import { resolveIdentity } from "./identity.js";

const accountScope = z.strictObject({
  account: z.uuid().brand<"AccountId">(),
  incarnation: z.uuid().brand<"Incarnation">(),
});
const contextSchema = z.discriminatedUnion("stage", [
  z.strictObject({ stage: z.literal("login"), uid: z.string() }),
  z.strictObject({ stage: z.literal("link-current") }),
  z.strictObject({ stage: z.literal("link-confirm"), target: accountScope }),
  z.strictObject({ stage: z.literal("link-candidate"), target: accountScope }),
]);
const flowSchema = z.strictObject({
  verifier: z.string(), nonce: z.string(), browser: z.string(), context: contextSchema,
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
    findAccount: (_ctx, accountId) => ({
      accountId,
      claims: () => ({ sub: accountId }),
    }),
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
    await pool.query(
      "INSERT INTO oauth_browser_flows(state,data,expires_at) VALUES($1,$2,now()+interval '5 minutes')",
      [
        digest(state),
        { verifier, nonce, browser: digest(browser), context },
      ],
    );
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
      await upstreamRedirect(res, { stage: "link-candidate", target: flow.context.target });
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
      if (!claims) throw new Error("Verified ID token required");
      if (flow.context.stage === "link-current") {
        const existing = await pool.query(
          "SELECT i.account,i.incarnation FROM oauth_identities i JOIN hunt_accounts a USING(account,incarnation) WHERE i.issuer=$1 AND i.subject=$2 AND NOT a.erased",
          [upstream.serverMetadata().issuer, claims.sub],
        );
        const target = accountScope.parse(existing.rows[0]);
        const confirmation = randomBytes(32).toString("base64url");
        await pool.query(
          "INSERT INTO oauth_browser_flows(state,data,expires_at) VALUES($1,$2,now()+interval '5 minutes')",
          [digest(confirmation), { ...flow, context: { stage: "link-confirm", target } }],
        );
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
      const account = await resolveIdentity(
        pool,
        upstream.serverMetadata().issuer,
        claims.sub,
      );
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
