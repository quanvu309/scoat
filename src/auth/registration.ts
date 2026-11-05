import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Adapter, ClientMetadata } from "oidc-provider";
import { chatgptRedirect } from "./config.js";
import type { AuthConfig } from "./config.js";

export function publicClient(client: AuthConfig["clients"][number]) {
  return {
    ...client,
    response_types: ["code"],
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "none",
    subject_type: "public",
  } satisfies ClientMetadata;
}

const display = z.string().max(1024);
const extension = z.union([display, z.boolean(), z.number().finite(), z.null(), z.array(z.string().max(256)).max(5)]);
const unsupported = new Set([
  "client_id", "client_secret", "software_statement", "jwks", "jwks_uri", "sector_identifier_uri",
  "request_uris", "request_object_signing_alg", "request_object_encryption_alg", "request_object_encryption_enc",
  "id_token_signed_response_alg", "id_token_encrypted_response_alg", "id_token_encrypted_response_enc",
  "userinfo_signed_response_alg", "userinfo_encrypted_response_alg", "userinfo_encrypted_response_enc",
  "token_endpoint_auth_signing_alg", "default_max_age", "require_auth_time", "default_acr_values", "initiate_login_uri",
  "post_logout_redirect_uris", "frontchannel_logout_uri", "frontchannel_logout_session_required",
  "backchannel_logout_uri", "backchannel_logout_session_required", "require_pushed_authorization_requests", "require_signed_request_object",
  "tls_client_auth_subject_dn", "tls_client_auth_san_dns", "tls_client_auth_san_uri", "tls_client_auth_san_ip", "tls_client_auth_san_email",
  "tls_client_certificate_bound_access_tokens", "dpop_bound_access_tokens", "authorization_signed_response_alg", "authorization_encrypted_response_alg", "authorization_encrypted_response_enc",
  "registration_access_token", "registration_client_uri", "client_id_issued_at", "client_secret_expires_at",
]);
export function callbackBinding(value: string) {
  if (value === chatgptRedirect) return { host: "gpt" as const, part: "stable", redirect: value };
  const chatgpt = /^https:\/\/chatgpt\.com\/connector\/oauth\/([A-Za-z0-9_-]{1,128})$/.exec(value);
  if (chatgpt?.[1]) return { host: "gpt" as const, part: chatgpt[1], redirect: value };
  if (value === "https://claude.ai/api/mcp/auth_callback") return { host: "claude" as const, part: "web", redirect: value };
  const loopback = /^http:\/\/(localhost|127\.0\.0\.1)(?::([1-9][0-9]{0,4}))?\/callback$/.exec(value);
  if (!loopback || (loopback[2] && Number(loopback[2]) > 65535)) return undefined;
  return { host: loopback[1] === "localhost" ? "local" as const : "ip4" as const, part: loopback[2] ?? "default", redirect: value };
}
const callback = z.string().max(200).refine(value => callbackBinding(value) !== undefined).brand<"HostCallback">();
const metadata = z.strictObject({
  redirect_uris: z.tuple([callback]),
  response_types: z.tuple([z.literal("code")]).optional(),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).min(1).max(2).refine(values => values.includes("authorization_code") && new Set(values).size === values.length).optional(),
  token_endpoint_auth_method: z.literal("none").optional(),
  application_type: z.enum(["web", "native"]).optional(),
  subject_type: z.literal("public").optional(),
  scope: z.string().min(1).max(128).refine(value => {
    const scopes = value.split(" ");
    return new Set(scopes).size === scopes.length && scopes.every(scope => ["openid", "offline_access", "scoat:read", "scoat:write"].includes(scope));
  }).optional(),
  client_name: display.optional(),
  client_uri: display.optional(),
  logo_uri: display.optional(),
  tos_uri: display.optional(),
  policy_uri: display.optional(),
  contacts: z.array(z.string().max(254)).max(5).optional(),
  software_id: display.optional(),
  software_version: display.optional(),
}).catchall(extension).superRefine((value, ctx) => {
  const binding = callbackBinding(value.redirect_uris[0]);
  if (value.application_type === "native" && binding?.host !== "local" && binding?.host !== "ip4") ctx.addIssue({ code: "custom", path: ["application_type"], message: "Native clients require loopback callbacks" });
  if (Object.keys(value).length > 40) ctx.addIssue({ code: "custom", message: "Too many metadata members" });
  for (const key of Object.keys(value)) {
    if (key.length > 128 || unsupported.has(key)) ctx.addIssue({ code: "custom", path: [key], message: "Unsupported security metadata" });
  }
});

export class RegisteredClients {
  readonly #issuer: string;
  readonly #client: ReturnType<typeof publicClient>;
  readonly #keys: NonNullable<AuthConfig["registrationKeys"]>;

  constructor(config: AuthConfig) {
    const client = config.clients.find(value => value.client_id === config.registrationClientId);
    if (!client || !config.registrationKeys) throw new Error("Registration requires a selected client and dedicated keys");
    this.#client = publicClient(client);
    this.#issuer = new URL(config.issuer).origin;
    const [current, ...retained] = config.registrationKeys;
    this.#keys = [{ ...current }, ...retained.map(key => ({ ...key }))];
  }

  #mac(secret: string, redirect: z.infer<typeof callback>) {
    return createHmac("sha256", secret).update(JSON.stringify(["scoat-chatgpt-client-v1", this.#issuer, this.#client.client_id, redirect])).digest("base64url");
  }

  #boundClient(id: string, redirect: string) {
    const binding = callbackBinding(redirect);
    return { ...publicClient({ client_id: id, redirect_uris: [redirect] }), ...(binding?.host === "local" || binding?.host === "ip4" ? { application_type: "native" as const } : {}) };
  }

  #hostMac(secret: string, host: string, redirect: string) {
    return createHmac("sha256", secret).update(JSON.stringify(["scoat-host-client-v2", this.#issuer, this.#client.client_id, host, redirect])).digest("base64url");
  }

  #clientFor(redirect: z.infer<typeof callback>) {
    if (redirect === chatgptRedirect) return this.#client;
    const binding = callbackBinding(redirect);
    if (!binding) throw new Error("Unsupported host callback");
    const key = this.#keys[0];
    const id = `scoat-cb.v2.${key.version}.${binding.host}.${binding.part}.${this.#hostMac(key.secret, binding.host, redirect)}`;
    return this.#boundClient(id, redirect);
  }

  metadata(raw: unknown) {
    const parsed = metadata.safeParse(raw);
    if (!parsed.success) return parsed.error.issues.some(issue => issue.path[0] === "redirect_uris")
      ? { error: "invalid_redirect_uri", error_description: "Only an exact supported host callback is accepted" }
      : { error: "invalid_client_metadata", error_description: "Unsupported OAuth client metadata" };
    return { ...this.#clientFor(parsed.data.redirect_uris[0]), scope: parsed.data.scope ?? "openid offline_access scoat:read scoat:write" };
  }

  resolve(id: string) {
    const legacy = /^scoat-cb\.v1\.([A-Za-z0-9_-]{1,8})\.([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9_-]{43})$/.exec(id);
    const current = /^scoat-cb\.v2\.([A-Za-z0-9_-]{1,8})\.(gpt|claude|local|ip4)\.([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9_-]{43})$/.exec(id);
    if (!legacy && !current) return undefined;
    const version = legacy?.[1] ?? current?.[1];
    const key = this.#keys.find(value => value.version === version);
    const host = current?.[2];
    const part = current?.[3];
    const redirect = legacy ? `https://chatgpt.com/connector/oauth/${legacy[2]}`
      : host === "gpt" ? `https://chatgpt.com/connector/oauth/${part}`
      : host === "claude" && part === "web" ? "https://claude.ai/api/mcp/auth_callback"
      : host === "local" || host === "ip4" ? `http://${host === "local" ? "localhost" : "127.0.0.1"}${part === "default" ? "" : ":" + part}/callback` : "";
    const parsed = callback.safeParse(redirect);
    const mac = legacy?.[3] ?? current?.[4];
    if (!key || !parsed.success || !mac) return undefined;
    const expected = legacy ? this.#mac(key.secret, parsed.data) : this.#hostMac(key.secret, host ?? "", parsed.data);
    if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return undefined;
    return this.#boundClient(id, parsed.data);
  }

  adapter(): Adapter {
    const immutable = async () => { throw new Error("Registered clients are immutable and stateless"); };
    return { find: async id => this.resolve(id), findByUserCode: async () => undefined, findByUid: async () => undefined, upsert: immutable, destroy: immutable, consume: immutable, revokeByGrantId: immutable };
  }

  refusal(raw: unknown) {
    const parsed = metadata.safeParse(raw);
    if (parsed.success) return undefined;
    const known = new Set([...Object.keys(metadata.shape), ...unsupported]);
    const object = z.record(z.string(), z.unknown()).safeParse(raw);
    const forbidden = object.success ? Object.keys(object.data).filter(key => unsupported.has(key)) : [];
    return {
      event: "oauth_registration_refused",
      fields: [...new Set([...forbidden, ...parsed.error.issues.map(issue => typeof issue.path[0] === "string" && known.has(issue.path[0]) ? issue.path[0] : "extension")])].sort().slice(0, 20),
    };
  }
}

export async function registerClient(req: IncomingMessage, res: ServerResponse, clients: RegisteredClients) {
  const respond = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", pragma: "no-cache", ...(status === 405 ? { allow: "POST" } : {}), ...(status === 413 ? { connection: "close" } : {}) });
    res.end(JSON.stringify(body));
  };
  const refuse = (status: number, description: string) => respond(status, { error: "invalid_client_metadata", error_description: description });
  if (req.method !== "POST") return refuse(405, "Use POST to register");
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"] ?? "")) return refuse(415, "Use application/json with UTF-8 encoding");
  if (req.headers["content-encoding"] !== undefined && req.headers["content-encoding"] !== "identity") return refuse(415, "Content encoding is unsupported");
  if (Number(req.headers["content-length"]) > 8192) return refuse(413, "Registration body exceeds 8192 bytes");
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      if (!Buffer.isBuffer(chunk)) return refuse(400, "Invalid registration body");
      size += chunk.length;
      if (size > 8192) return refuse(413, "Registration body exceeds 8192 bytes");
      chunks.push(chunk);
    }
    const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    const result = clients.metadata(raw);
    const refusal = clients.refusal(raw);
    if (refusal) console.warn(JSON.stringify(refusal));
    return respond("error" in result ? 400 : 201, result);
  } catch {
    return refuse(400, "Registration body must be a UTF-8 JSON object");
  }
}
