import { nonempty } from "./evidence.js";
import type { HuntId, Intent, NonEmpty, Offer, Profile, Quote, ReadyLink, RowId } from "../domain.js";
import type { Release } from "../knowledge/index.js";
import type { HuntView, RowView } from "./index.js";
import { pickBest } from "./pricing.js";
import { publicSourceUrl } from "../knowledge/index.js";

function rowGaps(row: RowView, originalSeller: string | null): string[] {
  if (row.skippedBy === "person") return [];
  const gaps: string[] = [];
  const sellers = new Set<string>();
  for (const value of row.slots) if (!row.row.slots.includes(value.slot)) gaps.push(`${row.row.id}/slot-${value.slot}: unexpected slot`);
  for (const slot of row.row.slots) {
    const matches = row.slots.filter(value => value.slot === slot);
    const value = matches[0];
    const name = `${row.row.id}/slot-${slot}`;
    if (matches.length !== 1 || !value) { gaps.push(`${name}: missing or duplicate slot`); continue; }
    if (row.row.place === "other-sellers") {
      const seller = value.seller?.trim().toLowerCase() || null;
      if (value.completion.kind === "checked" && (!seller || originalSeller === null || seller === originalSeller.trim().toLowerCase() || sellers.has(seller))) gaps.push(`${name}: distinct seller other than original shop required`);
      if (seller) sellers.add(seller);
    }
    if (value.completion.kind === "pending") gaps.push(`${name}: pending`);
    if (value.completion.kind === "gap") {
      if (!value.completion.reason.trim()) throw new Error("Named gap required");
    }
    if (value.completion.kind === "checked" && value.completion.proof.length === 0) gaps.push(`${name}: checked evidence required`);
  }
  return gaps;
}
export function finishable(rows: readonly RowView[], release: Release, originalSeller: string | null): { readonly ok: true } | { readonly ok: false; readonly open: NonEmpty<RowId> } {
  const open = release.rows.filter(recipe => {
    const matches = rows.filter(row => row.row.id === recipe.id);
    return matches.length !== 1 || !matches[0] || rowGaps({ ...matches[0], row: recipe }, originalSeller).length > 0;
  }).map(recipe => recipe.id);
  return open.length ? { ok: false, open: nonempty(open) } : { ok: true };
}
function cleanLink(raw: string) {
  const url = new URL(publicSourceUrl.parse(raw));
  for (const name of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|affiliate)/i.test(name)) url.searchParams.delete(name);
  url.hash = "";
  return publicSourceUrl.parse(url.href);
}
function renderText(view: Omit<HuntView, "text">): string {
  const amount = (pay: Quote["guaranteed"]) => pay.kind === "known" ? `GBP ${(pay.amount.pence / 100).toFixed(2)}` : `unknown: ${pay.gaps.join(", ")}`;
  return [
    `Coverage ${view.progress.resolved}/${view.progress.total}; ${view.directive.kind}`,
    ...view.rows.map(row => `${row.row.label}: ${row.skippedBy === "person" ? "person-skipped" : row.slots.map(slot => `slot-${slot.slot} ${slot.completion.kind}`).join(", ")}`),
    ...view.gaps,
    ...view.quotes.map(quote => `${quote.seller}: guaranteed ${amount(quote.guaranteed)}; budget ${JSON.stringify(quote.budget)}; conditional ${quote.conditional.map(c => `${amount(c.payToday)} requires ${c.requires.join(", ")}; budget ${JSON.stringify(c.budget)}; selection ${JSON.stringify(c.selection)}; back later ${JSON.stringify(c.backLater)}; perks ${JSON.stringify(c.perks)}`).join("; ")}; back later ${JSON.stringify(quote.backLater)}; perks ${JSON.stringify(quote.perks)}; untested ${quote.untested.map(o => o.id).join(", ")}; ${quote.limitations.join(", ")}`),
    ...(view.ready ? [`Product ${view.ready.url}; claim steps ${view.ready.steps.join(", ")}`] : [])
  ].join("\n");
}
export function renderView(args: { release: Release; intent: Intent; profile: Profile; rows: readonly RowView[]; offers: readonly Offer[]; quotes: readonly Quote[]; stopRequested: boolean; final: HuntView["final"]; ready: ReadyLink | null; hunt: HuntId }): HuntView {
  if (new Set(args.rows.map(row => row.row.id)).size !== args.rows.length || args.rows.length !== args.release.rows.length) throw new Error("All eight unique release rows required");
  const rows = args.release.rows.map(recipe => {
    const row = args.rows.find(value => value.row.id === recipe.id);
    if (!row) throw new Error(`Missing row ${recipe.id}`);
    return { ...row, row: recipe };
  });
  const completeRows = nonempty(rows);
  const originalSeller = args.intent.shop ?? rows.find(row => row.row.place === "shop-price")?.slots[0]?.seller ?? null;
  const result = finishable(rows, args.release, originalSeller);
  const open = result.ok ? [] : result.open;
  const gaps = [...rows.flatMap(row => [...rowGaps(row, originalSeller), ...row.slots.flatMap(slot => slot.completion.kind === "gap" ? [`${row.row.id}/slot-${slot.slot}: ${slot.completion.reason}`] : [])]), ...args.quotes.flatMap(quote => [...(quote.guaranteed.kind === "unknown" ? quote.guaranteed.gaps : []), ...quote.conditional.flatMap(c => c.payToday.kind === "unknown" ? c.payToday.gaps : []), ...quote.limitations].map(gap => `${quote.seller}/${quote.id}: ${gap}`))];
  const best = pickBest(args.quotes);
  const ready = args.ready ? { url: cleanLink(args.ready.url), steps: args.ready.steps } : args.intent.product.kind === "url" ? { url: cleanLink(args.intent.product.url), steps: [] } : null;
  const directive: HuntView["directive"] = args.final.kind === "finished" ? { kind: "complete" } : args.stopRequested ? { kind: "name-gaps-and-finish", rows: open } : result.ok ? { kind: "finish" } : { kind: "continue", rows: result.open };
  const progress = { resolved: rows.length - open.length, total: rows.length };
  const view = { hunt: args.hunt, release: args.release.id, intent: args.intent, profile: args.profile, rows: completeRows, offers: args.offers, quotes: args.quotes, progress, best, final: args.final, stopRequested: args.stopRequested, ready, directive, gaps };
  return { ...view, text: renderText(view) };
}
