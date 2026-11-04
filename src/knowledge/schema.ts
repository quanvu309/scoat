import { z } from "zod";
export const text = z.string().trim().min(1);
export const key = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
export const instant = z.iso.datetime().brand<"UtcInstant">();
export const publicSourceUrl = z.url().refine(value => {
  const parsed = new URL(value);
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  return parsed.protocol === "https:" && !parsed.username && !parsed.password
    && !z.ipv4().safeParse(host).success && !z.ipv6().safeParse(host).success && !host.startsWith("[") && host.includes(".")
    && !/(^|\.)(localhost|local|localdomain|internal|invalid|test|example|onion)$/.test(host)
    && host !== "home.arpa" && !host.endsWith(".home.arpa");
}, "Publish public HTTPS DNS sources; IP literals and local/reserved names are not public provenance").brand<"PublicHttpsUrl">();
export const places = ["shop-price", "other-sellers", "student", "membership", "codes", "cashback", "price-match", "card-perks"] as const;
const place = z.enum(places);
const fact = z.strictObject({
  id: key.brand<"FactId">(), shop: key, claim: text, place,
  source: publicSourceUrl, observedAt: instant, validUntil: instant,
  applies: z.enum(["online", "in-store", "both"]), refreshOwner: text,
  authority: z.enum(["primary", "third-party"]),
  status: z.enum(["confirmed", "needs-step", "untested", "unknown"]),
  kind: z.enum(["benefit", "student", "code", "official-domain"]),
  domain: z.string().nullable(), requires: z.array(text), references: z.array(key)
});
export const row = z.strictObject({ id: key.brand<"RowId">(), place, label: text, method: text, proofRequired: text, stopRule: text, slots: z.array(z.number().int().nonnegative()).min(1), facts: z.array(key) });
const shop = z.discriminatedUnion("status", [
  z.strictObject({ id: key, label: text, status: z.literal("unsupported"), reason: text, refreshOwner: text }),
  z.strictObject({ id: key, label: text, status: z.literal("supported"), facts: z.array(key).min(1) })
]);
export const releaseSchema = z.strictObject({ id: key.refine(value => value !== "latest", "Reserved release ID").brand<"ReleaseId">(), market: z.literal("GB"), publishedAt: instant, rows: z.array(row), shops: z.array(shop), facts: z.array(fact) });
