/** Parsed at the boundary: HTTPS public URL, valid UTC instant, and non-negative integer minor units. */
export type Url = string & { readonly __brand: 'Url' };
export type Instant = string & { readonly __brand: 'Instant' };
export type Id = string & { readonly __brand: 'Id' };
export type Revision = number & { readonly __brand: 'Revision' };
export type Money = { currency: 'GBP'; minor: number };
export type Evidence = { url: Url; observedAt: Instant };
export type Status =
  | { kind: 'confirmed' }
  | { kind: 'needs_step'; step: string }
  | { kind: 'untested' }
  | { kind: 'unknown' };
export type Code = { kind: 'none' } | { kind: 'code'; value: string };
export type Amount = { kind: 'fixed'; value: Money } | { kind: 'percent'; basisPoints: number };
export type Offer =
  | { kind: 'price'; status: Status; amount: Money }
  | { kind: 'discount'; status: Status; amount: Amount; code: Code }
  | { kind: 'delivery'; status: Status; amount: Money }
  | { kind: 'back_later'; status: Status; amount: Amount }
  | { kind: 'perk'; status: Status; detail: string }
  | { kind: 'unknown'; status: { kind: 'unknown' }; detail: string };
/** Every find has an observation; absence of a price is represented by unknown. */
export type Find = { id: Id; label: string; source: Evidence; offer: Offer };
export type RowStatus =
  | { kind: 'next' } | { kind: 'checking' }
  | { kind: 'done'; findIds: Id[]; note: string }
  | { kind: 'skipped'; by: 'person'; at: Instant }
  | { kind: 'gap'; reason: string };
export type Row = { id: Id; label: string; revision: Revision; status: RowStatus; finds: Find[] };
export type Product = { label: string; url: Url } | { label: string; description: string };
/** One price, explicit additions and discounts, each linked to a confirmed find. */
export type Selection = {
  priceFind: Id;
  destination: Url; // Must be the evidenced product page for the selected price.
  deliveryFinds: Id[];
  discountFinds: Id[];
  backLaterFinds: Id[];
  // Evidence for combining offers, including application order and percent base.
  stacking: { source: Evidence; orderedFinds: Id[]; explanation: string }[];
};
export type PricedResult = {
  lines: { findId: Id; label: string; source: Evidence; amount: Money; status: Status }[];
  payToday: Money; backLater: Money; budget: { kind: 'none' } | { kind: 'comparison'; amount: Money; differenceMinor: number; fits: boolean };
  alternatives: Find[]; destination: Url;
};
export type Result = { kind: 'priced'; value: PricedResult } | { kind: 'unknown'; reason: string; alternatives: Find[] };
export type Hunt = {
  id: Id; product: Product; budget: { kind: 'none' } | { kind: 'set'; amount: Money };
  playbookVersion: string; factsVersion: string; rows: Row[];
  stopRequested: boolean;
  state: { kind: 'active' } | { kind: 'finished'; result: Result };
};
/** Actionable failures contain current data when concurrency or a rule blocks progress. */
export type Refusal = { code: 'invalid' | 'conflict' | 'forbidden' | 'incomplete' | 'unproven' | 'unsupported' | 'idempotency_conflict'; message: string; next: string; current?: Hunt };
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: Refusal };
