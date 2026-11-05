import { z } from "zod";
import { publicSourceUrl } from "../knowledge/schema.js";
const utcSchema = z.iso.datetime();
const text = z.string().trim().min(1).max(2000);
export const offerIdSchema = text.brand<"OfferId">();
export const moneySchema = z.strictObject({ currency: z.literal("GBP"), pence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).brand<"SafePence">() });
export const proofSchema = z.strictObject({ url: publicSourceUrl, observedAt: z.iso.datetime().brand<"UtcInstant">(), note: text });
export const statusSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("confirmed") }),
  z.strictObject({ kind: z.literal("needs-step"), steps: z.array(z.enum(["verify-student", "join", "enrol", "activate", "apply-code", "request-price-match"])).min(1) }),
  z.strictObject({ kind: z.literal("untested") }),
  z.strictObject({ kind: z.literal("unknown"), reason: text })
]);
export const adjustmentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("fixed"), amount: moneySchema }),
  z.strictObject({ kind: z.literal("percent"), basisPoints: z.number().int().min(0).max(10000), basis: z.enum(["item", "remaining", "delivery"]) })
]);
const attested = { seller: text, variant: text, status: statusSchema, proof: proofSchema, validUntil: z.iso.datetime().nullable() };
export const offerInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...attested, kind: z.literal("price"), amount: moneySchema }),
  z.strictObject({ ...attested, kind: z.literal("delivery"), amount: moneySchema }),
  z.strictObject({ ...attested, kind: z.literal("discount"), adjustment: adjustmentSchema, code: text.nullable(), codeOrigin: z.enum(["retailer-tested", "lead"]).nullable(), minimumSpend: moneySchema, order: z.number().int().nonnegative().max(1000) }),
  z.strictObject({ ...attested, kind: z.literal("cashback"), amount: moneySchema, programme: text }),
  z.strictObject({ ...attested, kind: z.literal("points"), quantity: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), programme: text }),
  z.strictObject({ ...attested, kind: z.literal("perk"), description: text })
]);
const stored = { id: offerIdSchema, row: text.brand<"RowId">() };
export const offerSchema = z.discriminatedUnion("kind", [
  offerInputSchema.options[0].extend(stored),
  offerInputSchema.options[1].extend(stored),
  offerInputSchema.options[2].extend(stored),
  offerInputSchema.options[3].extend(stored),
  offerInputSchema.options[4].extend(stored),
  offerInputSchema.options[5].extend(stored)
]);
export const compatibilitySchema = z.strictObject({ offers: z.array(offerIdSchema).min(1).refine(ids => new Set(ids).size === ids.length), proof: z.array(proofSchema).min(1) });
export const selectionSchema = z.strictObject({ price: offerIdSchema, delivery: offerIdSchema.nullable(), benefits: z.array(offerIdSchema).max(16).refine(ids => new Set(ids).size === ids.length) });
