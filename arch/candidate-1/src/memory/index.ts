import type {
  AccountId, Agent, HuntId, Instant, ItemId, Money, Person, Product, Profile,
  RequestKey, Result, Revision, WatchId,
} from "../domain.js";
import type { HuntState, Hunts } from "../hunt/index.js";
import type { Delivery, Recheck } from "../delivery/index.js";
import type { ProfileChange, Profiles } from "./profile.js";

export type MemoryRequest =
  | { readonly op: "read" }
  | { readonly op: "profile"; readonly requestKey: RequestKey; readonly basis: Revision; readonly change: ProfileChange }
  | { readonly op: "save"; readonly requestKey: RequestKey; readonly hunt: HuntId }
  | { readonly op: "watch"; readonly requestKey: RequestKey; readonly hunt: HuntId; readonly target: Money }
  | { readonly op: "unwatch"; readonly requestKey: RequestKey; readonly watch: WatchId }
  | { readonly op: "erase"; readonly requestKey: RequestKey };
export type SavedItem = Readonly<{
  id: ItemId; product: Product; hunt: HuntId; snapshot: HuntState;
}>;
export type Watch = Readonly<{
  id: WatchId; item: ItemId; target: Money; state: "active" | "cancelled";
  lastChecked: Instant | null; lastReport: Recheck | null;
}>;
export type MemoryView = Readonly<{
  profile: Profile; saved: readonly SavedItem[]; watches: readonly Watch[];
  recentHunts: readonly HuntId[]; email: "verified" | "missing"; text: string;
}>;
export type MemoryReply = { readonly kind: "state"; readonly view: MemoryView }
  | { readonly kind: "erased" };
/** Independent per-account event journal; no writer ever updates a saved hunt snapshot in place. */
export type MemoryEvent =
  | { readonly kind: "saved"; readonly item: SavedItem }
  | { readonly kind: "watch-started"; readonly watch: Watch; readonly consentPolicy: string }
  | { readonly kind: "watch-cancelled"; readonly watch: WatchId }
  | { readonly kind: "rechecked"; readonly watch: WatchId; readonly utcDay: string; readonly report: Recheck }
  | { readonly kind: "notified"; readonly watch: WatchId; readonly improvementKey: string };
export class Memory {
  constructor(dependencies: { profiles: Profiles; hunts: Hunts; delivery: Delivery }) {
    // TODO Own journal/outbox storage internally. Envelopes include tenant, event ID, causal basis,
    // TODO actor and request digest; use the same atomic unique-key semantics as hunt storage.
    throw new Error("not implemented");
  }
  run(args: { actor: Agent | Person; request: MemoryRequest }): Promise<Result<MemoryReply>> {
    // TODO read includes account-scoped recent hunts for cross-host resume. profile delegates to Profiles.
    // TODO save/watch reads a validated finished HuntState from Hunts, freezes snapshot, auto-saves item.
    // TODO watch requires verified account email and explicit requested opt-in; no arbitrary recipient.
    // TODO unwatch is sticky for its watch ID; restarting creates a new watch ID, never resurrects one.
    // TODO Journal + dedup receipt are atomic. Mutations return current fold, read has no side effects.
    // TODO erase first fences OAuth/account/jobs, then purges profiles, hunts, saves, watches, grants,
    // TODO outbox, receipts and identity mapping; destroy tenant encryption key for retained backups.
    throw new Error("not implemented");
  }
  /** Scheduler calls daily; UTC-day job keys and per-watch leases tolerate crashes/multiple workers. */
  recheckDue(args: { utcDay: string }): Promise<void> {
    // TODO Query derived due-watch index. Recheck ONLY recorded public product/benefit links, no search.
    // TODO Enforce same seller/variant/availability, fresh price/delivery, conservative retained benefits.
    // TODO Missing/ambiguous proof => unknown report, never assume expired student/code/cashback survives.
    // TODO Append one report per watch/day and transactional email outbox entry if known payToday
    // TODO improves on baseline/last-notified price AND <= target; cashback alone cannot trigger it.
    // TODO Outbox delivery key = watch+improvement fingerprint; recheck cancellation/account fence at send.
    // TODO Mail provider must honor idempotency key; write notified after provider acceptance, retry safely.
    throw new Error("not implemented");
  }
  /** Durable partial-erasure workflow is restartable; no worker can recreate a fenced account. */
  resumeErasure(args: { account: AccountId }): Promise<void> {
    throw new Error("not implemented");
  }
  /** HTTP unsubscribe capability is limited to cancelling one watch; no account data is returned. */
  unsubscribe(args: { capability: string }): Promise<void> {
    // TODO Verify signed token and append cancellation idempotently; do not delegate a second writer.
    throw new Error("not implemented");
  }
}
