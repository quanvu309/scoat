import type { AccountId, ActorId, Failure, HttpUrl, HuntId, Human, Id, Instant, NonEmpty, Pence, Principal, Product, Profile, RequestId, Revision, RowId, Source, Status, Ticket } from "../core/index.js";
import type { Instruction, Plan, PlanRow, Release, StepKind } from "../knowledge/index.js";
export type Effect = { readonly kind: "base" | "discount" | "delivery"; readonly amount: Pence }
  | { readonly kind: "cashback"; readonly amount: Pence }
  | { readonly kind: "points"; readonly programme: string; readonly count: number }
  | { readonly kind: "perk"; readonly description: string };
/** An unknown benefit has no monetary value. Every observation, including unknown, has a source. */
export type Observation = {
  readonly source: Source; readonly subject: string; readonly conditions: readonly string[];
} & ({ readonly kind: "priced"; readonly status: Exclude<Status, { kind: "unknown" }>;
       readonly effect: Effect }
  | { readonly kind: "unknown"; readonly status: { readonly kind: "unknown" }; readonly reason: string });
/** Server-assigned attribution; never accepted from agent JSON. */
export interface AcceptedObservation {
  readonly id: Id<"observation">; readonly row: RowId; readonly seller: HttpUrl;
  readonly observation: Observation;
}
export interface Compatibility {
  readonly offers: readonly Id<"observation">[]; readonly allowed: boolean;
  readonly evidence: Source | Id<"fact">;
}
export type Answer<T> = { readonly kind: "found"; readonly observations: NonEmpty<T> }
  | { readonly kind: "none"; readonly searches: NonEmpty<Source>; readonly explanation: string }
  | { readonly kind: "gap"; readonly reason: string; readonly attempted: readonly Source[] };
export interface Proofs {
  readonly "identify-sellers": { readonly kind: "identify-sellers";
    readonly answer: Answer<{ readonly seller: HttpUrl; readonly source: Source }> };
  readonly quote: { readonly kind: "quote"; readonly answer: Answer<Observation> };
  readonly benefit: { readonly kind: "benefit"; readonly answer: Answer<Observation> };
  readonly verify: { readonly kind: "verify"; readonly offer: Id<"observation">;
    readonly outcome: { readonly kind: "verified"; readonly source: Source }
      | { readonly kind: "gap"; readonly reason: string } };
  readonly compatibility: { readonly kind: "compatibility";
    readonly offers: readonly Id<"observation">[];
    readonly outcome: { readonly kind: "proved"; readonly source: Source; readonly allowed: boolean }
      | { readonly kind: "gap"; readonly reason: string } };
}
export type Work<K extends StepKind = StepKind> = { [P in K]: {
  readonly kind: "work"; readonly ticket: Ticket; readonly expiresAt: Instant;
  readonly row: RowId; readonly instruction: Instruction<P>;
  /** Schema identifier is generated from Proofs[P]; exact inputs are in instruction. */
  readonly returnSchema: `scoat:proof/${P}`;
} }[K];
export type Submission = { [P in StepKind]: {
  readonly kind: "submit"; readonly huntId: HuntId; readonly ticket: Ticket; readonly proof: Proofs[P];
} }[StepKind];
export type Advance = { readonly kind: "start"; readonly product: Product; readonly budget: Pence | null; readonly context: Profile }
  | { readonly kind: "next"; readonly huntId: HuntId }
  | Submission;
export type Terminal = { readonly kind: "done"; readonly observations: readonly Id<"observation">[] }
  | { readonly kind: "skipped"; readonly human: Id<"human-gesture"> }
  | { readonly kind: "gap"; readonly reason: string };
export type RowState = Terminal | { readonly kind: "next" }
  | { readonly kind: "checking"; readonly actor: ActorId; readonly leaseUntil: Instant };
export interface ChecklistRow { readonly row: PlanRow; readonly state: RowState }
type TodayEffect = Extract<Effect, { readonly kind: "base" | "discount" | "delivery" }>;
type LaterEffect = Extract<Effect, { readonly kind: "cashback" | "points" }>;
export interface PriceLine<E extends Effect = Effect> { readonly label: string; readonly effect: E; readonly proof: Source }
export type BudgetFit = { readonly kind: "no-budget" }
  | { readonly kind: "within"; readonly remaining: Pence }
  | { readonly kind: "over"; readonly excess: Pence };
/** Only confirmed, mutually compatible lines enter this total; cashback never reduces it. */
export interface Guaranteed {
  readonly kind: "guaranteed"; readonly payToday: Pence; readonly fit: BudgetFit;
  readonly lines: NonEmpty<PriceLine<TodayEffect>>; readonly backLater: readonly PriceLine<LaterEffect>[];
}
export interface Conditional {
  readonly kind: "conditional"; readonly payToday: Pence; readonly fit: BudgetFit;
  readonly requires: NonEmpty<string>; readonly lines: NonEmpty<PriceLine<TodayEffect>>;
  readonly backLater: readonly PriceLine<LaterEffect>[];
}
export interface Result {
  readonly guaranteed: Guaranteed | { readonly kind: "unknown"; readonly reason: string };
  readonly conditional: readonly Conditional[];
  readonly untested: readonly Observation[]; readonly gaps: readonly string[];
  readonly ready: { readonly url: HttpUrl; readonly disclosure: string } | null;
}
export interface HuntView {
  readonly id: HuntId; readonly revision: Revision; readonly product: Product; readonly budget: Pence | null;
  readonly plan: Plan; readonly rows: readonly ChecklistRow[];
  readonly progress: { readonly terminal: number; readonly total: number };
  readonly phase: "running" | "stopped" | "complete";
  readonly best: Result; readonly text: string;
}
export type Next = Work | { readonly kind: "wait"; readonly retryAfterSeconds: number }
  | { readonly kind: "stopped"; readonly result: Result }
  | { readonly kind: "complete"; readonly result: Result };
export type AdvanceReply = { readonly kind: "accepted"; readonly receipt: Id<"receipt">;
  readonly hunt: HuntView; readonly next: Next } | Failure;
export type Control = { readonly kind: "stop" }
  | { readonly kind: "skip"; readonly rowId: RowId };
/** The only hunt writer. Stores account-scoped plan snapshots and append-only actor journals. */
export class Hunts {
  /** Transaction: dedupe → fold controls → validate ticket/proof → append → issue eligible work.
   * Ticket binds account, hunt, row, kind, input hash, lease epoch and executor capability.
   * Tickets are transferable to same-account subagents; actor journals record the submitter.
   * next has at most one live ticket per actor; extra actors get independent ready rows.
   * A duplicate request returns its stored receipt AND original next ticket; next/read refreshes.
   * Same requestId + different body conflicts. Lost replies cannot duplicate finds or leases.
   */
  async advance(input: { principal: Principal; requestId: RequestId; command: Advance }): Promise<AdvanceReply> {
    // TODO Serialize projection per hunt; persist receipt, lease and evidence atomically.
    // TODO Actor/request dedupe; start dedupe is account/actor/request, before hunt creation.
    // TODO Reclaim expired leases, preserve prior evidence; stale lease submissions conflict.
    // TODO Ready rows only; graph expansion and validation obligations precede finalization.
    // TODO Verification/stacking requests are bounded server-added obligations per offer set;
    // TODO unmet verification closes as a named gap while preserving conditional offers.
    // TODO Pin request context over saved profile; persist snapshot, never silently save it.
    throw new Error("not implemented");
  }
  async read(input: { principal: Principal; huntId: HuntId; afterRevision: Revision | null }): Promise<HuntView | { readonly kind: "unchanged" } | Failure> {
    throw new Error("not implemented");
  }
  async list(input: { principal: Principal; cursor: string | null }): Promise<{ readonly hunts: readonly HuntView[]; readonly nextCursor: string | null }> {
    throw new Error("not implemented");
  }
  /** Person intent has its own journal; agents cannot manufacture skips.
   * Stop closes unfinished rows as named 'person stopped' gaps, revokes leases, then finalizes.
   * Skip wins over same-row evidence: retain evidence as audit-only, never price from it.
   * Controls against terminal hunts conflict. A new hunt is required to resume stopped work.
   */
  async control(input: { human: Human; huntId: HuntId; requestId: RequestId; action: Control }): Promise<HuntView | Failure> {
    throw new Error("not implemented");
  }
}
/** Boundary decoder checks kind against ticket and validates exact requested subjects.
 * seller-site codes may be confirmed; third-party codes always untested until seller proof.
 * Reject future/stale observation time, absent source, unknown with amount, wrong variant,
 * amounts without unit/meaning, arbitrary status upgrades and fabricated dependency closure.
 */
function decodeProof(input: { payload: unknown; work: Work; now: Instant }): Proofs[StepKind] {
  throw new Error("not implemented");
}
/** Pure projection. No final result while a row is nonterminal or an expansion is unresolved. */
function summarize(input: { rows: readonly ChecklistRow[]; observations: readonly Observation[]; budget: Pence | null }): Result {
  // TODO Compare complete seller baskets; never combine base from A with delivery from B.
  // TODO Build compatibility constraints from pinned facts and verified evidence.
  // TODO Unknown stacking excludes combination. Require proved delivery for guaranteed total.
  // TODO Conditional verification/join/enrol scenarios separate; untested never guaranteed.
  throw new Error("not implemented");
}
/** Persistence indexes: account/id; hunt/row; hunt/actor/request; account/updatedAt/id.
 * A transaction locks only the hunt projection; actor records are insert-only.
 * Control and submission are linearized by revision, never by client clocks.
 * No process-local state is authoritative: any host can read and claim expired work.
 */
interface JournalEvent {
  readonly hunt: HuntId; readonly account: AccountId; readonly actor: ActorId;
  readonly request: RequestId; readonly revision: Revision;
  readonly payload: { readonly kind: "evidence"; readonly row: RowId; readonly proof: Proofs[StepKind] }
    | { readonly kind: "control"; readonly action: Control; readonly human: Id<"human-gesture"> };
}
