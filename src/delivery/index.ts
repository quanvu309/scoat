import { createHash } from "node:crypto";
import { z } from "zod";
import { FetchFailure, fetchPublic, publicDns } from "./fetch.js";
import type { AddressPolicy, FetchFailureReason } from "./fetch.js";
import { pihut, readDelivery, readProduct } from "./pihut.js";
import type { DeliveryUnknown, ProductUnknown } from "./pihut.js";

export const watchTargetSchema = z.strictObject({
 parser: z.literal(pihut.parser),
 seller: z.literal(pihut.seller),
 url: z.literal(pihut.product),
 variant: z.number().int().refine(value => pihut.variants.has(value)),
 sku: z.string().min(1).max(32),
 quantity: z.literal(1),
 delivery: z.strictObject({ destination: z.literal("GB"), service: z.literal(pihut.service), rule: z.literal(pihut.rule), lithium: z.literal(false), membership: z.literal("none") }),
}).refine(target => pihut.variants.get(target.variant)?.sku === target.sku);
export type PublicWatchTarget = z.infer<typeof watchTargetSchema>;

export type UnknownReason = FetchFailureReason | ProductUnknown | DeliveryUnknown;
export const unknownReasons = ["blocked-destination", "redirect-refused", "too-many-redirects", "http-status", "oversized", "timeout", "network", "product-format-changed", "currency-not-gbp", "variant-changed", "unavailable", "conditional-pricing", "conflicting-product", "delivery-rule-changed"] as const satisfies readonly UnknownReason[];
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

export function basisDigest(observation: Extract<Observation, { kind: "comparable" }>): string {
 return createHash("sha256").update(JSON.stringify(observation.basis)).digest("hex");
}
export function cleanShopUrl(target: PublicWatchTarget): string {
 return `${target.url}?variant=${target.variant}`;
}

export type MailMessage = Readonly<{ from: string; subject: string; text: string; html: string; headers: Readonly<Record<string, string>> }>;
export type Submission = { kind: "accepted"; id: string } | { kind: "rejected"; status: number } | { kind: "ambiguous"; reason: string };
export const submitLimitMilliseconds = 8000;
export const resendOrigin = "https://api.resend.com";

export class Delivery {
 constructor(private readonly deps: Readonly<{ resolve: AddressPolicy; mail: Readonly<{ origin: string; apiKey: string }> | null }>) {}

 static production(apiKey: string | null): Delivery {
  return new Delivery({ resolve: publicDns, mail: apiKey === null ? null : { origin: resendOrigin, apiKey } });
 }

 async observe(target: PublicWatchTarget, signal: AbortSignal): Promise<Observation> {
  const hosts = new Set([pihut.host]);
  try {
   const product = await fetchPublic(target.url, hosts, this.deps.resolve, signal);
   if (product.url !== target.url) return { kind: "unknown", reason: "redirect-refused" };
   const item = readProduct(product.body.toString("utf8"), target.variant);
   if (item.kind === "unknown") return item;
   const page = await fetchPublic(pihut.delivery, hosts, this.deps.resolve, signal);
   if (page.url !== pihut.delivery) return { kind: "unknown", reason: "redirect-refused" };
   const delivery = readDelivery(page.body.toString("utf8"));
   if (delivery.kind === "unknown") return delivery;
   return {
    kind: "comparable",
    basis: { url: target.url, seller: target.seller, variant: target.variant, sku: item.sku, currency: "GBP", availability: "in-stock", delivery: { destination: target.delivery.destination, service: target.delivery.service, rule: target.delivery.rule } },
    itemPence: item.pence, deliveryPence: delivery.pence, amountPence: item.pence + delivery.pence,
    proof: { product: product.sha256, delivery: page.sha256 },
   };
  } catch (error) {
   if (error instanceof FetchFailure) return { kind: "unknown", reason: error.reason };
   return { kind: "unknown", reason: signal.aborted ? "timeout" : "network" };
  }
 }

 async submit(message: MailMessage, to: string, key: string, signal: AbortSignal): Promise<Submission> {
  if (!this.deps.mail) return { kind: "ambiguous", reason: "mail-unconfigured" };
  let response: Response;
  try {
   response = await fetch(this.deps.mail.origin + "/emails", {
    method: "POST", redirect: "error", signal,
    headers: { authorization: "Bearer " + this.deps.mail.apiKey, "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ from: message.from, to: [to], subject: message.subject, text: message.text, html: message.html, headers: message.headers }),
   });
  } catch {
   return { kind: "ambiguous", reason: signal.aborted ? "deadline" : "network" };
  }
  let body: unknown;
  try {
   const text = await response.text();
   body = text.length <= 65536 ? JSON.parse(text) : null;
  } catch {
   body = null;
  }
  const accepted = z.strictObject({ id: z.string().min(1).max(256) }).safeParse(body);
  if (response.status === 200 && accepted.success) return { kind: "accepted", id: accepted.data.id };
  if (response.status === 409 || response.status === 429 || response.status >= 500 || response.status === 200) return { kind: "ambiguous", reason: "status-" + response.status };
  return { kind: "rejected", status: response.status };
 }
}
