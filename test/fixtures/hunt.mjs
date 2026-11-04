import { seed } from "./knowledge.mjs";
import { validateRelease } from "../../dist/knowledge/index.js";
import { offerSchema } from "../../dist/hunt/evidence.js";
export const now = "2026-11-04T12:00:00Z";
export const proof = { url: "https://www.nike.com/gb/", observedAt: now, note: "SYNTHETIC Nike observation, no current retailer claim" };
export const gbp = pence => ({ currency: "GBP", pence });
export const intent = { product: { kind: "url", url: "https://www.nike.com/gb/t/synthetic?utm_source=test#tracking" }, variant: "UK 6 / black", shop: "nike", budget: gbp(6000) };
export const release = validateRelease(seed(), now);
export function offer(id, kind, fields = {}) {
  return offerSchema.parse({ id, row: release.rows[0].id, seller: "nike", variant: intent.variant, status: { kind: "confirmed" }, proof, validUntil: null, kind, ...(kind === "discount" ? { adjustment: { kind: "fixed", amount: gbp(100) }, code: null, codeOrigin: null, order: 0, minimumSpend: gbp(0) } : {}), ...fields });
}
export const compatibility = (...offers) => ({ offers: offers.map(o => o.id), proof: [proof] });
export function fixture() {
  const price = offer("nike-price", "price", { amount: gbp(7000) });
  const delivery = offer("nike-delivery", "delivery", { amount: gbp(0) });
  const student = offer("student", "discount", { adjustment: { kind: "percent", basisPoints: 1000, basis: "item" }, status: { kind: "needs-step", steps: ["verify-student"] } });
  const cashback = offer("cashback", "cashback", { amount: gbp(190), programme: "SYNTHETIC programme" });
  return { offers: [price, delivery, student, cashback], intent, now, release, selection: null, compatibility: [compatibility(price, delivery, cashback), compatibility(price, delivery, student), compatibility(price, delivery, student, cashback)] };
}
export function rows() {
  return release.rows.map(row => ({ row, revision: 0, skippedBy: null, slots: row.slots.map(slot => ({ slot, seller: row.place === "other-sellers" ? `seller-${slot}` : "nike", completion: { kind: "checked", proof: [proof], offers: [] } })) }));
}
export function viewArgs(quotes) { return { release, intent, profile: { student: "unknown", cards: [], memberships: [] }, rows: rows(), offers: fixture().offers, quotes, stopRequested: false, final: { kind: "open" }, ready: null, hunt: "synthetic-hunt" }; }
