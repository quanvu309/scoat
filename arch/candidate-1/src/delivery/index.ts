import type { AccountId, HuntId, Instant, Proof, Quote, ReadyLink, ReleaseId, Url } from "../domain.js";
import type { HuntState } from "../hunt/index.js";

export type Recheck = Readonly<{
  checkedAt: Instant; release: ReleaseId;
  result: { readonly kind: "known";
      readonly quote: Quote & { readonly guaranteed: Extract<Quote["guaranteed"], { kind: "known" }> };
      readonly proof: readonly Proof[] }
    | { readonly kind: "unknown"; readonly reason: string; readonly proof: readonly Proof[] };
}>;
/** Owns network policy; hunt arithmetic remains solely in hunt/priceQuote, reused for rechecks. */
export class Delivery {
  ready(args: { account: AccountId; hunt: HuntId; quote: Quote }): Promise<ReadyLink> {
    // TODO Mint/reuse short-lived signed opaque redirect capability for the selected sourced seller URL.
    // TODO Preserve product/variant; attach allowlisted affiliate parameters; disclose affiliation.
    // TODO No network enrolment available => original seller link with explicit untagged reason.
    // TODO Conditional offer steps stay visible; never imply verification or checkout has been performed.
    throw new Error("not implemented");
  }
  /** HTTP GET /r/:capability. A bearer can only open this fixed destination, never inspect account data. */
  redirect(args: { capability: string }): Promise<{ readonly status: 302; readonly location: Url }> {
    // TODO Verify signature/expiry/account fence, resolve fixed allowlisted URL; reject arbitrary targets.
    // TODO Never rewrite evidence URLs. Never collect payment or submit seller forms.
    throw new Error("not implemented");
  }
  recheck(args: { snapshot: HuntState; now: Instant }): Promise<Recheck> {
    // TODO Fetch only public recorded links through SSRF-safe HTTPS allowlists, bounded redirects/timeouts.
    // TODO Supported seller parsers produce new sourced offers, normalize statuses and call priceQuote.
    // TODO No parser/variant match/proof => unknown; no agent/browser search or partner API credentials.
    throw new Error("not implemented");
  }
  send(args: { account: AccountId; deliveryKey: string; report: Recheck; ready: ReadyLink; unsubscribe: Url }): Promise<void> {
    // TODO Read verified email server-side; check consent/fence, send separate payToday/backLater sections,
    // TODO dated proof links, affiliate disclosure and signed unsubscribe capability; no address in tool input.
    throw new Error("not implemented");
  }
  erase(args: { account: AccountId }): Promise<void> {
    // TODO Revoke redirect/unsubscribe capabilities, pending mail and identity/email mapping.
    throw new Error("not implemented");
  }
}
