import type { AccountId, HttpUrl, HuntId, Id, Instant } from "../core/index.js";
export interface ReadyLink { readonly url: HttpUrl; readonly disclosure: string }
/** Owns attribution and redirect safety, never money or checkout. */
export class Delivery {
  /** Only a proved seller destination; preserves product variant and explains unmet steps.
   * Sign opaque random ID; store account/hunt/destination. No identity or proof in query params.
   * Affiliate fallback is an untagged public link with explicit attribution disclosure.
   */
  async ready(input: { account: AccountId; hunt: HuntId; destination: HttpUrl }): Promise<ReadyLink> {
    throw new Error("not implemented");
  }
  /** GET /r/:token; allowlisted destination only, revocable on account deletion.
   * No host session required to open; token grants navigation only, never account access.
   */
  async resolve(token: string): Promise<HttpUrl | { readonly kind: "gone" }> {
    throw new Error("not implemented");
  }
  /** Transactional outbox, stable provider idempotency key, verified email and unsubscribe link.
   * If provider lacks dedupe, mark uncertain sends for reconciliation rather than blind retry.
   */
  async deliverDue(input: { now: Instant; limit: number }): Promise<void> {
    throw new Error("not implemented");
  }
}
interface MailEvent {
  readonly id: Id<"mail">; readonly account: AccountId;
  readonly kind: "verify-address" | "price-improved";
  readonly recipient: Id<"verified-or-pending-address">;
  readonly dedupe: string; readonly accountGeneration: number;
}
