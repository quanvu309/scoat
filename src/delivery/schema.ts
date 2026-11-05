import { z } from "zod";
export const unknownReasons = ["blocked-destination", "redirect-refused", "too-many-redirects", "http-status", "oversized", "timeout", "network", "product-format-changed", "currency-not-gbp", "variant-changed", "unavailable", "conditional-pricing", "conflicting-product", "delivery-rule-changed"] as const;
export const observationSchema = z.discriminatedUnion("kind", [
 z.strictObject({
  kind: z.literal("comparable"),
  basis: z.strictObject({ url: z.string(), seller: z.string(), variant: z.number().int(), sku: z.string(), currency: z.literal("GBP"), availability: z.literal("in-stock"), delivery: z.strictObject({ destination: z.literal("GB"), service: z.string(), rule: z.string() }) }),
  itemPence: z.number().int().positive(), deliveryPence: z.number().int().nonnegative(), amountPence: z.number().int().positive(),
  proof: z.strictObject({ product: z.string().regex(/^[0-9a-f]{64}$/), delivery: z.string().regex(/^[0-9a-f]{64}$/) }),
 }),
 z.strictObject({ kind: z.literal("unknown"), reason: z.enum(unknownReasons) }),
]);
export type Observation = z.infer<typeof observationSchema>;

