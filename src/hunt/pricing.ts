import { z } from "zod";
import type { BudgetFit, Compatibility, Intent, Line, Money, Offer, PayToday, Quote, Selection, Step } from "../domain.js";
import { nonempty, compatibilitySchema, moneySchema, offerSchema, parseEvidence, selectionSchema, validateProof } from "./evidence.js";

export const benefitLimit = 16;
export const money = (pence: number): Money => moneySchema.parse({ currency: "GBP", pence });
const key = (ids: readonly string[]) => JSON.stringify([...ids].sort());
function line(offer: Offer): Line {
  return { offer: offer.id, label: offer.kind, proof: offer.proof, status: offer.status,
    value: "amount" in offer ? offer.amount : offer.kind === "points" ? { points: offer.quantity } : { text: offer.kind === "perk" ? offer.description : "discount" } };
}
function budget(pay: PayToday, intent: Intent): BudgetFit {
  if (!intent.budget) return { kind: "no-budget" };
  if (pay.kind === "unknown") return { kind: "unknown" };
  return pay.amount.pence <= intent.budget.pence ? { kind: "within" } : { kind: "over", by: money(pay.amount.pence - intent.budget.pence) };
}
export function calculate(price: Extract<Offer, { kind: "price" }>, delivery: Extract<Offer, { kind: "delivery" }> | undefined, discounts: readonly Extract<Offer, { kind: "discount" }>[]): PayToday {
  const lines: [Line, ...Line[]] = [line(price), ...(delivery ? [line(delivery)] : []), ...discounts.map(line)];
  if (!delivery || price.status.kind !== "confirmed" || delivery.status.kind !== "confirmed") return { kind: "unknown", gaps: ["Known confirmed price and delivery required"], lines };
  let item = BigInt(price.amount.pence);
  let shipping = BigInt(delivery.amount.pence);
  for (const offer of [...discounts].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id, "en"))) {
    if (price.amount.pence < offer.minimumSpend.pence) throw new Error(`Minimum spend not met: ${offer.id}`);
    const adjustment = offer.adjustment;
    const onDelivery = adjustment.kind === "percent" && adjustment.basis === "delivery";
    const basis = adjustment.kind === "fixed" ? 0n : adjustment.basis === "item" ? BigInt(price.amount.pence) : onDelivery ? shipping : item;
    const reduction = adjustment.kind === "fixed" ? BigInt(adjustment.amount.pence) : basis * BigInt(adjustment.basisPoints) / 10000n;
    if (onDelivery) shipping -= reduction > shipping ? shipping : reduction;
    else item -= reduction > item ? item : reduction;
  }
  const sum = item + shipping;
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Pay-today arithmetic overflow");
  return { kind: "known", amount: money(Number(sum)), lines };
}
export function priceQuotes(args: { offers: readonly Offer[]; intent: Intent; now: string; compatibility?: readonly Compatibility[]; selection: Selection | null; release?: unknown }): readonly Quote[] {
  if (args.intent.budget) moneySchema.parse(args.intent.budget);
  const offers = args.offers.map(raw => offerSchema.parse(raw));
  if (new Set(offers.map(offer => offer.id)).size !== offers.length) throw new Error("Duplicate offer ID");
  for (const offer of offers) {
    const { id, row, ...input } = offer;
    parseEvidence(input, { intent: args.intent, seller: offer.seller, now: args.now });
  }
  const byId = new Map(offers.map(offer => [offer.id, offer]));
  const authority = new Set<string>();
  const validSets = new Map<string, Offer[][]>();
  for (const raw of args.compatibility ?? []) {
    const entry = compatibilitySchema.parse(raw);
    entry.proof.forEach(proof => validateProof(proof, args.now));
    const resolved = entry.offers.map(id => { const offer = byId.get(id); if (!offer) throw new Error("Dangling compatibility reference"); return offer; });
    if (resolved.some(offer => offer.seller !== resolved[0]?.seller || offer.variant !== resolved[0]?.variant) || resolved.filter(offer => offer.kind === "price").length !== 1 || resolved.filter(offer => offer.kind === "delivery").length > 1) throw new Error("Mismatched compatibility references");
    authority.add(key(entry.offers));
    const anchorKey = key(resolved.filter(o => o.kind === "price" || o.kind === "delivery").map(o => o.id));
    const sets = validSets.get(anchorKey) ?? [];
    sets.push(resolved.filter(o => o.kind !== "price" && o.kind !== "delivery"));
    validSets.set(anchorKey, sets);
  }
  const requested = args.selection === null ? null : selectionSchema.parse(args.selection);
  if (requested) {
    const p = byId.get(requested.price), d = requested.delivery === null ? null : byId.get(requested.delivery);
    const benefits = requested.benefits.map(id => byId.get(id));
    if (p?.kind !== "price" || (requested.delivery !== null && d?.kind !== "delivery") || benefits.some(b => !b || b.kind === "price" || b.kind === "delivery" || b.seller !== p.seller || b.variant !== p.variant || !["confirmed", "needs-step"].includes(b.status.kind)) || (d && (d.seller !== p.seller || d.variant !== p.variant)) || (benefits.length > 0 && !authority.has(key([requested.price, ...(requested.delivery ? [requested.delivery] : []), ...requested.benefits])))) throw new Error("Unsupported selection");
  }
  const quotes: Quote[] = [];
  for (const price of offers.filter(o => o.kind === "price")) {
    if (requested && requested.price !== price.id) continue;
    const matching = offers.filter(o => o.seller === price.seller && o.variant === price.variant);
    const benefits = matching.filter(o => o.kind !== "price" && o.kind !== "delivery");
    const deliveries = matching.filter(o => o.kind === "delivery");
    const choices = requested ? [requested.delivery === null ? undefined : deliveries.find(d => d.id === requested.delivery)] : deliveries.length ? deliveries : [undefined];
    for (const delivery of choices) {
      const anchor = [price.id, ...(delivery ? [delivery.id] : [])];
      const limitations = benefits.length > benefitLimit ? ["benefit-limit-exceeded: maximum 16 per anchor; optimum incomplete"] : [];
      if (requested && limitations.length && requested.benefits.length) throw new Error(limitations[0]);
      type Candidate = { benefits: Offer[]; pay: PayToday; steps: Step[]; rank: string };
      const candidates: Candidate[] = [];
      const sets: Offer[][] = limitations.length ? [[]] : [[], ...(validSets.get(key(anchor)) ?? [])];
      for (const chosen of sets) {
        if (requested && key(chosen.map(o => o.id)) !== key(requested.benefits)) continue;
        if (chosen.some(o => o.status.kind === "unknown" || o.status.kind === "untested" || (o.kind === "discount" && o.minimumSpend.pence > price.amount.pence))) continue;
        const steps = [...new Set(chosen.flatMap(o => o.status.kind === "needs-step" ? o.status.steps : []))].sort();
        const discounts = chosen.filter(o => o.kind === "discount");
        candidates.push({ benefits: chosen, rank: key(chosen.map(o => o.id)), steps, pay: calculate(price, delivery, discounts) });
      }
      if (requested && candidates.length === 0) throw new Error("Unsupported selection or minimum spend");
      const sorted = candidates.sort((a, b) => (a.pay.kind === "known" ? a.pay.amount.pence : Infinity) - (b.pay.kind === "known" ? b.pay.amount.pence : Infinity) || b.benefits.length - a.benefits.length || a.rank.localeCompare(b.rank, "en"));
      const best = sorted.find(c => c.steps.length === 0) ?? { benefits: [], steps: [], pay: calculate(price, delivery, []) };
      const selected = requested ? sorted[0] ?? best : best;
      const conditional = sorted.filter(c => c.steps.length > 0).slice(0, 1).map(c => ({ payToday: c.pay, requires: nonempty(c.steps), budget: budget(c.pay, args.intent) }));
      quotes.push({ id: z.string().brand<"QuoteId">().parse(key(anchor)), seller: price.seller, selection: { price: price.id, delivery: delivery?.id ?? null, benefits: selected.benefits.map(o => o.id) }, guaranteed: best.pay, budget: budget(best.pay, args.intent), conditional, backLater: best.benefits.filter(o => o.kind === "cashback" || o.kind === "points").map(line), perks: best.benefits.filter(o => o.kind === "perk").map(line), limitations, untested: matching.filter(o => o.status.kind === "untested") });
    }
  }
  return quotes;
}
export function pickBest(quotes: readonly Quote[]): Quote | null {
  return [...quotes].filter(q => q.guaranteed.kind === "known" && q.limitations.length === 0).sort((a, b) => (a.guaranteed.kind === "known" ? a.guaranteed.amount.pence : Infinity) - (b.guaranteed.kind === "known" ? b.guaranteed.amount.pence : Infinity) || a.id.localeCompare(b.id, "en"))[0] ?? null;
}
