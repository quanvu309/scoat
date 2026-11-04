import { nonempty } from "./evidence.js";
import type { HuntId, Intent, NonEmpty, Offer, Profile, Quote, ReadyLink, RowId } from "../domain.js";
import type { Release } from "../knowledge/index.js";
import type { HuntView, RowView } from "./index.js";
import { pickBest } from "./pricing.js";
import { publicSourceUrl } from "../knowledge/index.js";

function rowGaps(row: RowView): string[] {
  if (row.skippedBy === "person") return [];
  const gaps: string[] = [];
  const sellers = new Set<string>();
  for (const slot of row.row.slots) {
    const matches = row.slots.filter(value => value.slot === slot);
    const value = matches[0];
    const name = `${row.row.id}/slot-${slot}`;
    if (matches.length !== 1 || !value) { gaps.push(`${name}: missing or duplicate slot`); continue; }
    if (row.row.place === "other-sellers") {
      if ((value.completion.kind === "checked" && !value.seller) || (value.seller !== null && sellers.has(value.seller))) gaps.push(`${name}: distinct seller required`);
      if (value.seller) sellers.add(value.seller);
    }
    if (value.completion.kind === "pending") gaps.push(`${name}: pending`);
    if (value.completion.kind === "gap") {
      if (!value.completion.reason.trim()) throw new Error("Named gap required");
    }
    if (value.completion.kind === "checked" && value.completion.proof.length === 0) gaps.push(`${name}: checked evidence required`);
  }
  return gaps;
}
export function finishable(rows: readonly RowView[], release: Release): { readonly ok: true } | { readonly ok: false; readonly open: NonEmpty<RowId> } {
  const open = release.rows.filter(recipe => {
    const matches = rows.filter(row => row.row.id === recipe.id);
    return matches.length !== 1 || !matches[0] || rowGaps({ ...matches[0], row: recipe }).length > 0;
  }).map(recipe => recipe.id);
  return open.length ? { ok: false, open: nonempty(open) } : { ok: true };
}
function cleanLink(raw: string) {
  const url = new URL(publicSourceUrl.parse(raw));
  for (const name of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|affiliate)/i.test(name)) url.searchParams.delete(name);
  url.hash = "";
  return publicSourceUrl.parse(url.href);
}
export function renderView(args: { release: Release; intent: Intent; profile: Profile; rows: readonly RowView[]; offers: readonly Offer[]; quotes: readonly Quote[]; stopRequested: boolean; final: HuntView["final"]; ready: ReadyLink | null; hunt: HuntId }): HuntView {
  if (new Set(args.rows.map(row => row.row.id)).size !== args.rows.length || args.rows.length !== args.release.rows.length) throw new Error("All eight unique release rows required");
  const rows = args.release.rows.map(recipe => {
    const row = args.rows.find(value => value.row.id === recipe.id);
    if (!row) throw new Error(`Missing row ${recipe.id}`);
    return { ...row, row: recipe };
  });
  const completeRows = nonempty(rows);
  const result = finishable(rows, args.release);
  const open = result.ok ? [] : result.open;
  const gaps = rows.flatMap(row => [...rowGaps(row), ...row.slots.flatMap(slot => slot.completion.kind === "gap" ? [`${row.row.id}/slot-${slot.slot}: ${slot.completion.reason}`] : [])]);
  const best = pickBest(args.quotes);
  const ready = args.ready ? { url: cleanLink(args.ready.url), steps: args.ready.steps } : args.intent.product.kind === "url" ? { url: cleanLink(args.intent.product.url), steps: [] } : null;
  const directive: HuntView["directive"] = args.final.kind === "finished" ? { kind: "complete" } : args.stopRequested ? { kind: "name-gaps-and-finish", rows: open } : result.ok ? { kind: "finish" } : { kind: "continue", rows: result.open };
  const progress = { resolved: rows.length - open.length, total: rows.length };
  const amount = (pay: Quote["guaranteed"]) => pay.kind === "known" ? `GBP ${(pay.amount.pence / 100).toFixed(2)}` : `unknown: ${pay.gaps.join(", ")}`;
  const text = [
    `Coverage ${progress.resolved}/${progress.total}; ${directive.kind}`,
    ...rows.map(row => `${row.row.label}: ${row.skippedBy === "person" ? "person-skipped" : row.slots.map(slot => `slot-${slot.slot} ${slot.completion.kind}`).join(", ")}`),
    ...gaps,
    ...args.quotes.map(quote => `${quote.seller}: guaranteed ${amount(quote.guaranteed)}; budget ${JSON.stringify(quote.budget)}; conditional ${quote.conditional.map(c => `${amount(c.payToday)} requires ${c.requires.join(", ")}; budget ${JSON.stringify(c.budget)}`).join("; ")}; back later ${JSON.stringify(quote.backLater)}; perks ${JSON.stringify(quote.perks)}; untested ${quote.untested.map(o => o.id).join(", ")}; ${quote.limitations.join(", ")}`),
    ...(ready ? [`Product ${ready.url}; claim steps ${ready.steps.join(", ")}`] : [])
  ].join("\n");
  return { hunt: args.hunt, release: args.release.id, intent: args.intent, profile: args.profile, rows: completeRows, offers: args.offers, progress, best, final: args.final, stopRequested: args.stopRequested, ready, directive, gaps, text };
}
