import { z } from "zod";

const https = z.url({ protocol: /^https$/ }).refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password && !url.hash && !url.search;
});
const redirect = https;
export const chatgptRedirect = "https://chatgpt.com/connector_platform_oauth_redirect";
export const authConfigSchema = z.strictObject({
  issuer: https.refine((value) => new URL(value).pathname === "/"),
  upstreamIssuer: https,
  upstreamClientId: z.string().min(1).max(200),
  upstreamClientSecret: z.string().min(1).max(4096),
  lifecycleKey: z.string().min(64).max(256),
  lifecycleKeyVersion: z.string().min(1).max(64),
  cookieKeys: z.array(z.string().min(32)).min(1).max(3),
  jwks: z.strictObject({
    keys: z.array(z.record(z.string(), z.unknown())).min(1).max(3),
  }),
  registrationClientId: z.string().min(1).max(200).optional(),
  clients: z
    .array(
      z.strictObject({
        client_id: z
          .string()
          .min(1)
          .max(200)
          .regex(/^[A-Za-z0-9._~-]+$/),
        redirect_uris: z.array(redirect).min(1).max(10),
      }),
    )
    .min(1)
    .max(20),
}).superRefine((config, ctx) => {
  const ids = config.clients.map(client => client.client_id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["clients"], message: "OAuth client IDs must be unique" });
  if (config.registrationClientId === undefined) return;
  const selected = config.clients.find(client => client.client_id === config.registrationClientId);
  const matches = config.clients.filter(client => client.redirect_uris.includes(chatgptRedirect));
  if (!selected || selected.redirect_uris.length !== 1 || selected.redirect_uris[0] !== chatgptRedirect || matches.length !== 1)
    ctx.addIssue({ code: "custom", path: ["registrationClientId"], message: "Registration requires one selected public client with only the exact ChatGPT callback" });
});
export type AuthConfig = z.infer<typeof authConfigSchema>;
