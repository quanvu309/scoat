import { z } from "zod";
import { publicSourceUrl, isOfficialSource } from "../knowledge/index.js";
import type { Intent, Result } from "../domain.js";
import type { Release, Row } from "../knowledge/index.js";

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
export const evidenceMaxAgeMs = 86_400_000;
export function validateProof(raw: unknown, now: string) {
  const proof = proofSchema.parse(raw);
  const at = Date.parse(utcSchema.parse(now));
  const age = at - Date.parse(proof.observedAt);
  if (age < 0 || age > evidenceMaxAgeMs) throw new Error("Evidence is future or older than 24 hours");
  return proof;
}
export function parseEvidence(raw: unknown, context: { intent: Intent; seller: string; now: string; release: Release }) {
  const offer = offerInputSchema.parse(raw);
  validateProof(offer.proof, context.now);
  if (offer.validUntil !== null && Date.parse(offer.validUntil) <= Date.parse(context.now)) throw new Error("Expired evidence");
  if (offer.seller !== context.seller || offer.variant !== context.intent.variant) throw new Error("Exact seller and variant required");
  if (offer.kind === "discount" && offer.code !== null && (offer.codeOrigin === null || (offer.codeOrigin === "lead" && offer.status.kind !== "untested"))) throw new Error("Code leads remain untested until retailer-tested");
  if (offer.kind === "discount" && offer.code !== null && offer.codeOrigin === "retailer-tested" && !isOfficialSource({ release: context.release, seller: offer.seller, source: offer.proof.url, now: context.now })) throw new Error("Retailer-tested code requires current official retailer source evidence");
  return offer;
}
export function checkEvidence(args: { offer: unknown; intent: Intent; release: Release; row: Row; now: string; seller?: string }): Result<z.infer<typeof offerInputSchema>> {
  try {
    if (!args.release.rows.some(row => row.id === args.row.id)) throw new Error("Unknown checklist row");
    const seller = args.seller ?? args.intent.shop;
    if (!seller) throw new Error("Explicit seller required");
    return { ok: true, value: parseEvidence(args.offer, { ...args, seller }) };
  } catch (error) {
    return { ok: false, error: { code: "invalid", message: String(error), next: "Supply fresh exact source-backed evidence" } };
  }
}
export function assertRecordAllowed(stopRequested: boolean, outcome: { kind: string }) {
  if (stopRequested && outcome.kind === "found") throw new Error("Stop refuses every further found outcome");
}

export function nonempty<T>(values: readonly T[]): readonly [T, ...T[]] {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error("Nonempty values required");
  return [first, ...rest];
}
