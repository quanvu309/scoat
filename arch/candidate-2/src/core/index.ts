/** All branded values originate at a validating boundary; no casting constructors. */
export type Id<K extends string> = string & { readonly __brand: K };
export type AccountId = Id<"account">;
export type HuntId = Id<"hunt">;
export type RowId = Id<"row">;
export type ActorId = Id<"actor">;
export type RequestId = Id<"request">;
export type ReleaseId = Id<"release">;
export type Ticket = Id<"ticket">;
export type HttpUrl = Id<"public-http-url">;
export type Instant = Id<"iso-instant">;
export type Pence = number & { readonly __brand: "nonnegative-safe-integer-gbp" };
export type Revision = number & { readonly __brand: "revision" };
export type NonEmpty<T> = readonly [T, ...T[]];
export interface Principal { readonly account: AccountId; readonly actor: ActorId }
/** Minted by app-origin verification or host interaction attestation, never JSON claims. */
export interface Human extends Principal { readonly consent: Id<"human-gesture"> }
export interface Source { readonly url: HttpUrl; readonly observedAt: Instant; readonly excerpt: string }
export interface Product { readonly url: HttpUrl; readonly label: string; readonly variant: string; readonly market: "GB" }
export interface Profile { readonly student: boolean; readonly cards: readonly string[]; readonly memberships: readonly string[] }
export type Status = { readonly kind: "confirmed" }
  | { readonly kind: "needs-step"; readonly step: "verify" | "join" | "enrol"; readonly instructions: string }
  | { readonly kind: "untested" } | { readonly kind: "unknown" };
export interface Failure {
  readonly kind: "invalid" | "conflict" | "expired-ticket" | "unavailable" | "not-found";
  readonly message: string; readonly retry: "same-request" | "correct-request" | "read-hunt";
}
