import type { Failure, HttpUrl, Human, HuntId, Id, Instant, Pence, Principal, RequestId, Revision, Source } from "../core/index.js";
import type { Result } from "../hunt/index.js";
export type WatchAction = { readonly kind: "create"; readonly hunt: HuntId; readonly target: Pence; readonly email: string }
  | { readonly kind: "verify-email"; readonly token: string }
  | { readonly kind: "cancel"; readonly watch: Id<"watch">; readonly expected: Revision };
export interface WatchView {
  readonly id: Id<"watch">; readonly revision: Revision; readonly target: Pence;
  readonly status: "awaiting-email" | "active" | "cancelled";
  readonly nextCheck: Instant | null;
  readonly last: { readonly kind: "checked"; readonly at: Instant; readonly result: Result }
    | { readonly kind: "gap"; readonly at: Instant; readonly reason: string } | null;
}
/** Owns daily scheduling, not a background LLM. Uses only previously found public URLs. */
export class Watches {
  async list(principal: Principal): Promise<readonly WatchView[]> { throw new Error("not implemented"); }
  async change(input: { human: Human; requestId: RequestId; action: WatchAction }): Promise<WatchView | Failure> {
    // TODO Require completed owned hunt, explicit email consent, verified address before alerts.
    throw new Error("not implemented");
  }
  /** UTC daily buckets, unique watch/day jobs; lease expiry permits crash recovery.
   * Recheck full basket, including delivery, eligibility and stacking freshness.
   * Reuse hunt proof validator/pricing; if proof expires report gap, never reuse stale total.
   * Alert when guaranteed pay falls below baseline/last alerted price; label target fit.
   * Conditional prices and cashback changes alone cannot trigger a pay-today alert.
   */
  async runDue(input: { now: Instant; limit: number }): Promise<{ readonly checked: number; readonly gaps: number }> {
    // TODO dueAt index + lease; commit check and outbox event together, unique watch/day/price.
    // TODO Refresh applicable knowledge release, revalidate all relevant claims, record version.
    // TODO Persist cancelled/account-generation fence before email handoff.
    throw new Error("not implemented");
  }
}
/** Allowlisted public URL adapters; block private IPs, redirects to private nets, oversized bodies.
 * No search, sign-in, checkout automation or invented observation timestamps.
 */
interface PublicRecheck {
  fetch(input: { url: HttpUrl; now: Instant }): Promise<
    { readonly kind: "observed"; readonly source: Source; readonly payload: unknown }
    | { readonly kind: "gap"; readonly reason: string }>;
}
