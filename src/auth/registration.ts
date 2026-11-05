import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { ClientMetadata } from "oidc-provider";
import { chatgptRedirect } from "./config.js";
import type { AuthConfig } from "./config.js";

export function publicClient(client: AuthConfig["clients"][number]) {
  return {
    ...client,
    response_types: ["code"],
    grant_types: ["authorization_code"],
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
const metadata = z.strictObject({
  redirect_uris: z.tuple([z.literal(chatgptRedirect)]),
  response_types: z.tuple([z.literal("code")]).optional(),
  grant_types: z.tuple([z.literal("authorization_code")]).optional(),
  token_endpoint_auth_method: z.literal("none").optional(),
  application_type: z.literal("web").optional(),
  subject_type: z.literal("public").optional(),
  scope: z.string().min(1).max(128).refine(value => {
    const scopes = value.split(" ");
    return new Set(scopes).size === scopes.length && scopes.every(scope => ["openid", "scoat:read", "scoat:write"].includes(scope));
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
  if (Object.keys(value).length > 40) ctx.addIssue({ code: "custom", message: "Too many metadata members" });
  for (const key of Object.keys(value)) {
    if (key.length > 128 || unsupported.has(key)) ctx.addIssue({ code: "custom", path: [key], message: "Unsupported security metadata" });
  }
});

export function registrationMetadata(raw: unknown, client: ReturnType<typeof publicClient>) {
  const parsed = metadata.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.some(issue => issue.path[0] === "redirect_uris")
    ? { error: "invalid_redirect_uri", error_description: "Only the exact configured ChatGPT callback is supported" }
    : { error: "invalid_client_metadata", error_description: "Unsupported OAuth client metadata" };
  return { ...client, scope: parsed.data.scope ?? "openid scoat:read scoat:write" };
}

export async function registerClient(req: IncomingMessage, res: ServerResponse, client: ReturnType<typeof publicClient>) {
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
    const result = registrationMetadata(raw, client);
    return respond("error" in result ? 400 : 201, result);
  } catch {
    return refuse(400, "Registration body must be a UTF-8 JSON object");
  }
}
