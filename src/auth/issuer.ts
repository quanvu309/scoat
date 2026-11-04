import { randomBytes, createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import Provider from "oidc-provider";
import * as oidc from "openid-client";
import type pg from "pg";
import { z } from "zod";
import { postgresAdapter } from "./adapter.js";
import { authConfigSchema } from "./config.js";
import { linkIdentity } from "./link.js";
import type { AccountScope } from "../domain.js";
import { resolveIdentity, principalFor } from "./identity.js";

const flowSchema = z.strictObject({
  uid: z.string(),
  verifier: z.string(),
  nonce: z.string(),
  browser: z.string(),
  stage: z.enum(["login", "link-current", "link-candidate"]),
  target: z
    .strictObject({
      account: z.uuid().brand<"AccountId">(),
      incarnation: z.uuid().brand<"Incarnation">(),
    })
    .nullable(),
});
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
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
    features: {
      devInteractions: { enabled: false },
      revocation: {
        enabled: true,
        allowedPolicy: (_ctx, client, token) =>
          client.clientId === token.clientId,
      },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => resource,
        getResourceServerInfo: (_ctx, value) => {
          if (value !== resource) throw new Error("Invalid resource");
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
    const authorization = z
      .string()
      .max(4096)
      .regex(/^Bearer [A-Za-z0-9._~-]+$/)
      .parse(req.headers.authorization);
    const token = await provider.AccessToken.find(authorization.slice(7));
    if (
      !token ||
      token.isExpired ||
      token.aud !== resource ||
      token.isSenderConstrained() ||
      !token.scope?.split(" ").includes("scoat:read") ||
      !token.sessionUid
    )
      throw new Error("Invalid access token");
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
      throw new Error("Revoked OAuth session or grant");
    return principalFor(
      pool,
      token.accountId,
      z.string().min(1).parse(token.clientId),
      token.sessionUid,
      token.scope,
    );
  }
  async function upstreamRedirect(
    res: ServerResponse,
    uid: string,
    stage: "login" | "link-current" | "link-candidate",
    target: AccountScope | null,
  ) {
    const state = oidc.randomState(),
      verifier = oidc.randomPKCECodeVerifier(),
      nonce = oidc.randomNonce(),
      browser = randomBytes(32).toString("base64url");
    await pool.query(
      "INSERT INTO oauth_browser_flows(state,data,expires_at) VALUES($1,$2,now()+interval '5 minutes')",
      [
        digest(state),
        { uid, verifier, nonce, browser: digest(browser), stage, target },
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
      if (req.method !== "POST" || req.headers.origin !== issuer) {
        res.writeHead(403);
        res.end();
        return;
      }
      const principal = await authenticate(req);
      await upstreamRedirect(res, "", "link-current", {
        account: principal.agent.account,
        incarnation: principal.agent.incarnation,
      });
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
    if (
      url.pathname === "/auth" &&
      (!url.searchParams.get("state") ||
        url.searchParams.get("code_challenge_method") !== "S256" ||
        !url.searchParams.get("resource"))
    ) {
      res.writeHead(400);
      res.end("State, resource and PKCE S256 required");
      return;
    }
    if (url.pathname.startsWith("/interaction/")) {
      const details = await provider.interactionDetails(req, res);
      if (details.prompt.name === "login" && req.method === "GET") {
        await upstreamRedirect(res, details.uid, "login", null);
        return;
      }
      if (details.prompt.name === "consent" && details.session) {
        const csrf = digest(
          config.cookieKeys.join(":") + details.uid + details.session.uid,
        );
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
        if (
          req.method !== "POST" ||
          req.headers.origin !== issuer ||
          submitted.get("csrf") !== csrf ||
          !["allow", "deny"].includes(submitted.get("decision") ?? "")
        ) {
          res.writeHead(403);
          res.end();
          return;
        }
        if (submitted.get("decision") === "deny") {
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
      const browser = req.headers.cookie
        ?.split("; ")
        .find((value) => value.startsWith("__Host-scoat-flow="))
        ?.slice(18);
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
      if (flow.stage === "link-current") {
        if (!flow.target) throw new Error("Missing link target");
        const current = await resolveIdentity(
          pool,
          upstream.serverMetadata().issuer,
          claims.sub,
        );
        if (
          current.account !== flow.target.account ||
          current.incarnation !== flow.target.incarnation
        )
          throw new Error("Reauthentication must match the existing account");
        await upstreamRedirect(res, "", "link-candidate", flow.target);
        return;
      }
      if (flow.stage === "link-candidate") {
        if (!flow.target)
          throw new Error("Missing reauthenticated link target");
        await linkIdentity(
          pool,
          flow.target,
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
      const account = await resolveIdentity(
        pool,
        upstream.serverMetadata().issuer,
        claims.sub,
      );
      const interaction = await provider.Interaction.find(flow.uid);
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
