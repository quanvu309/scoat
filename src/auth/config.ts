import { z } from "zod";

const https = z.url({ protocol: /^https$/ }).refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password && !url.hash && !url.search;
});
const redirect = https;
export const authConfigSchema = z.strictObject({
  issuer: https.refine((value) => new URL(value).pathname === "/"),
  upstreamIssuer: https,
  upstreamClientId: z.string().min(1).max(200),
  upstreamClientSecret: z.string().min(1).max(4096),
  cookieKeys: z.array(z.string().min(32)).min(1).max(3),
  jwks: z.strictObject({
    keys: z.array(z.record(z.string(), z.unknown())).min(1).max(3),
  }),
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
});
export type AuthConfig = z.infer<typeof authConfigSchema>;
