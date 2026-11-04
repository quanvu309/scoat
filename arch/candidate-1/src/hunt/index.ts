import type {
  AccountId, Agent, EventId, HuntId, Instant, Intent, NonEmpty, Offer, OfferId, OfferInput,
  Person, Profile, Proof, Quote, QuoteId, ReadyLink, ReleaseId, RequestKey, Result,
  Revision, RowId, Selection, WriterId,
} from "../domain.js";
import type { Knowledge, Release, Row } from "../knowledge/index.js";
import type { Profiles } from "../memory/profile.js";
import type { Delivery } from "../delivery/index.js";
import type { HuntStore } from "./store.js";

export type CheckOutcome =
  | { readonly kind: "checking" }
  | { readonly kind: "found"; readonly offers: NonEmpty<OfferInput> }
  | { readonly kind: "none"; readonly checked: string; readonly proof: NonEmpty<Proof> }
  | { readonly kind: "gap"; readonly reason: string };
export type Note =
  | { readonly kind: "check"; readonly row: RowId; readonly slot: number; readonly outcome: CheckOutcome }
  | { readonly kind: "quote"; readonly selection: Selection }
  | { readonly kind: "retract"; readonly offer: OfferId; readonly reason: string };
export type Control = { readonly kind: "stop" }
  | { readonly kind: "skip"; readonly row: RowId };
export type HuntRequest =
  | { readonly op: "start"; readonly requestKey: RequestKey; readonly release: ReleaseId; readonly intent: Intent }
  | { readonly op: "read"; readonly hunt: HuntId }
  | { readonly op: "record"; readonly hunt: HuntId; readonly requestKey: RequestKey;
      readonly basis: Revision; readonly notes: NonEmpty<Note> }
  | { readonly op: "finish"; readonly hunt: HuntId; readonly requestKey: RequestKey;
      readonly basis: Revision; readonly quote: QuoteId | null };

/** All payloads are normalized and versioned before persistence; unknown historic versions fail closed. */
export type EventBody =
  | { readonly kind: "opened"; readonly intent: Intent; readonly profile: Profile;
      readonly release: ReleaseId }
  | { readonly kind: "logged"; readonly notes: NonEmpty<Note> }
  | { readonly kind: "controlled"; readonly control: Control }
  | { readonly kind: "finished"; readonly basis: Revision; readonly quote: QuoteId | null };
export type HuntEvent = Readonly<{
  version: 1; id: EventId; hunt: HuntId; writer: WriterId;
  actor: "agent" | "person"; requestKey: RequestKey; receivedAt: Instant;
  /** Server expands the submitted causal cut into IDs. Empty only for opened; no wall-clock ordering. */
  seen: readonly EventId[]; body: EventBody;
}>;
export type SlotProgress = Readonly<{
  slot: number;
  state: { readonly kind: "next" } | { readonly kind: "checking" }
    | { readonly kind: "done"; readonly receipts: NonEmpty<EventId> }
    | { readonly kind: "gap"; readonly reasons: NonEmpty<string> };
}>;
export type RowProgress = Readonly<{
  row: Row; slots: NonEmpty<SlotProgress>;
  state: "done" | "checking" | "next" | "skipped" | "gap";
  /** Includes the person event for skips/stops, so agents cannot manufacture either. */
  controls: readonly EventId[]; gaps: readonly string[];
}>;
export type HuntState = Readonly<{
  hunt: HuntId; revision: Revision; intent: Intent; profile: Profile; release: ReleaseId;
  rows: NonEmpty<RowProgress>; offers: readonly Offer[]; quotes: readonly Quote[];
  progress: { readonly resolved: number; readonly total: number };
  best: Quote | null;
  controls: { readonly stop: boolean; readonly skipped: readonly RowId[] };
  final: { readonly kind: "open" }
    | { readonly kind: "finished"; readonly quote: Quote | null; readonly revision: Revision }
    | { readonly kind: "needs-review"; readonly reason: string };
}>;
/** Same structured state powers the card and host text; text is regenerated, never separately stored. */
export type HuntView = HuntState & Readonly<{
  ready: ReadyLink | null; text: string;
  directive: "continue" | "stop-and-finish" | "refresh-and-finish" | "complete";
}>;
export type HuntReply = Readonly<{ receipt: EventId | null; view: HuntView }>;

/** Pure projection: the text, card and next-step directive cannot disagree about a hunt. */
export function renderView(args: { state: HuntState; ready: ReadyLink | null }): HuntView {
  // TODO Include every row/gap, controls, line status, conditional steps, source/date and budget shortfall.
  // TODO Never combine payToday/backLater. Unknown prints unknown, never zero; disclose affiliate links.
  // TODO A text-only user stop is recorded by the agent as named gaps, never a manufactured person skip.
  throw new Error("not implemented");
}

/**
 * Pure, deterministic and independent of input order, wall clock, SDK and database.
 * Invariant: fold(A ∪ B) = fold(B ∪ A); identical event IDs are applied once.
 */
export function fold(args: { events: NonEmpty<HuntEvent>; release: Release }): HuntState {
  // TODO Verify one opening/release match; derive rows via checklist(release,intent,pinnedProfile).
  // TODO Never read latest memory/facts or persist a second editable checklist definition.
  // TODO Union offers/receipts; IDs = event ID + note/offer position. Retractions are grow-only tombstones.
  // TODO Sort every derived collection by recipe order or stable ID, never database/input arrival order.
  // TODO Slot: valid completed check > named gap > checking > next. Distinct seller identities must
  // TODO satisfy four-seller coverage; repeated domains/slots cannot inflate completion.
  // TODO Person skip overrides its row. Sticky stop converts unresolved slots to named stop gaps.
  // TODO Row is done iff all slots are done; terminal with any gap => gap; skip is independently terminal.
  // TODO Keep concurrent late finds; after stop, reject new causal research but allow corrections/finish.
  // TODO Revision hashes ALL sorted event IDs. Every seen reference exists in this causally closed set.
  // TODO Seed baseline quotes from every price and matching delivery (null => unknown, never zero).
  // TODO Add agent-selected combinations with stack proof; no quote note needed for best-so-far.
  // TODO Recompute candidates; prefer lowest known guaranteed pay-today, then stable quote ID.
  // TODO Finish is valid iff its seen set covers every current non-finish event and rows are terminal.
  // TODO Later work/control invalidates finish; causally later valid finish supersedes earlier finishes;
  // TODO concurrent valid finishes tie-break by stable event ID. No causal-cut database lookup in fold.
  throw new Error("not implemented");
}
/**
 * Owns money, eligibility and stacking. Agent-supplied totals are never accepted.
 * Guaranteed includes confirmed applicable lines only; uncertain delivery/price yields unknown.
 */
export function priceQuote(args: {
  id: QuoteId; selection: Selection; offers: readonly Offer[]; release: Release; intent: Intent;
}): Result<Quote> {
  // TODO Resolve existing non-retracted IDs; same seller/variant; null delivery forces unknown total.
  // TODO Reject duplicate benefits, impossible negative amounts and percent outside 0..10000.
  // TODO Honor explicit stacking denials; require curated applicable allowance or observed checkout
  // TODO proof for combinations. Missing stacking proof downgrades the benefit, never the base price.
  // TODO Ready-link quotes are online: exclude in-store-only facts and unsupported card-linked offers.
  // TODO Apply ordered reductions to declared bases, clamp at zero; reject arithmetic overflow.
  // TODO Exclude needs-step/untested/unknown lines from guaranteed savings. Unknown facts add no price.
  // TODO Calculate separately labeled conditional scenarios only when amounts/bases are evidenced.
  // TODO Cashback and points go ONLY into backLater. Budget fit is ONLY against each payToday ledger.
  throw new Error("not implemented");
}
/** Profile, catalog, store and delivery are injected concrete owners, not transport dependencies. */
export type HuntDependencies = Readonly<{
  store: HuntStore; knowledge: Knowledge; profiles: Profiles; delivery: Delivery;
}>;
export class Hunts {
  constructor(dependencies: HuntDependencies) {
    // TODO Retain concrete dependencies; no mutable per-request hunt state on this service.
    throw new Error("not implemented");
  }
  /** Coarse operation: appends at most one immutable batch and returns a fresh fold plus text/card. */
  run(args: { agent: Agent; request: HuntRequest }): Promise<Result<HuntReply>> {
    // TODO Scope every lookup by OAuth account. start ID derives from account+requestKey.
    // TODO Resolve existing idempotency receipt BEFORE consulting mutable profile/latest state.
    // TODO On start freeze release/intent/profile in opened; derive checklist, never store another copy.
    // TODO Parse/check product scope, referenced IDs/slots and proof times before accepting events.
    // TODO Third-party code sources normalize to untested even if the agent says confirmed.
    // TODO Normalize stale/expired evidence to unknown using receivedAt and the pinned freshness policy.
    // TODO read is side-effect-free. record accepts stale causal cuts and merges independent notes.
    // TODO finish requires current basis and terminal rows; otherwise return stale/incomplete + guidance.
    // TODO Null final quote is allowed only when no candidate exists; otherwise select a returned quote ID.
    // TODO Append idempotently; read again after append so a racing finish can return needs-review.
    // TODO On retries return same receipt with latest view; no duplicate events or ready links.
    throw new Error("not implemented");
  }
  /** App-only person controls share the fold but cannot be expressed by an agent HuntRequest. */
  control(args: { person: Person; hunt: HuntId; requestKey: RequestKey; control: Control }): Promise<Result<HuntReply>> {
    // TODO Verify grant-bound person and owned hunt. Append controlled, then fold; skip is sticky.
    throw new Error("not implemented");
  }
  /** Poll is observational: no checking leases or timestamps mutate the event log. */
  inspect(args: { person: Person; hunt: HuntId; after: Revision | null }): Promise<Result<HuntView>> {
    // TODO Return latest full fold even when unchanged; clients never maintain a second merge algorithm.
    throw new Error("not implemented");
  }
  /** @internal Account is authenticated by the owning service, never accepted from MCP arguments. */
  snapshot(args: { account: AccountId; hunt: HuntId }): Promise<Result<HuntState>> {
    throw new Error("not implemented");
  }
  recent(args: { account: AccountId }): Promise<readonly HuntId[]> {
    throw new Error("not implemented");
  }
  /** @internal Erasure coordinator blocks the account before invoking this. */
  erase(args: { account: AccountId }): Promise<void> {
    throw new Error("not implemented");
  }
}
