/** Shared domain values, never SDK, storage or OAuth wire objects. All arrays are immutable. */
export type Id<Tag extends string> = string & { readonly __brand: Tag };
export type AccountId = Id<"AccountId">;
export type HuntId = Id<"HuntId">;
export type WriterId = Id<"WriterId">;
export type EventId = Id<"EventId">;
export type Revision = Id<"Revision">;
export type RequestKey = Id<"RequestKey">;
export type ReleaseId = Id<"ReleaseId">;
export type FactId = Id<"FactId">;
export type RowId = Id<"RowId">;
export type OfferId = Id<"OfferId">;
export type QuoteId = Id<"QuoteId">;
export type ItemId = Id<"ItemId">;
export type WatchId = Id<"WatchId">;
export type Url = Id<"PublicHttpsUrl">;
export type Instant = Id<"UtcInstant">;
export type NonEmpty<T> = readonly [T, ...T[]];
export type Money = Readonly<{ currency: "GBP"; pence: number }>;
/** Non-negative safe integer pence; round percentage reductions down once per line. */
export type Proof = Readonly<{ url: Url; observedAt: Instant; note: string }>;
export type Step = "verify-student" | "join" | "enrol" | "activate" | "apply-code" | "request-price-match";
export type Status =
  | { readonly kind: "confirmed" }
  | { readonly kind: "needs-step"; readonly steps: NonEmpty<Step> }
  | { readonly kind: "untested" }
  | { readonly kind: "unknown"; readonly reason: string };
export type Product = { readonly kind: "url"; readonly url: Url }
  | { readonly kind: "description"; readonly text: string };
export type Intent = Readonly<{
  product: Product; shop: string | null; job: "product"; budget: Money | null;
}>;
/** User declarations are private context, never proof that an offer applies. */
export type Profile = Readonly<{
  revision: Revision; market: "GB"; student: "yes" | "no" | "unknown";
  cards: readonly string[]; memberships: readonly string[];
}>;
export type Adjustment =
  | { readonly kind: "fixed"; readonly amount: Money }
  | { readonly kind: "percent"; readonly basisPoints: number;
      readonly basis: "original-item" | "remaining-item" | "delivery" };
type Attested = Readonly<{ status: Status; proof: Proof }>;
/** Each offer belongs to the pinned product/variant and exactly one seller. */
export type OfferInput = Attested & Readonly<{ seller: string }> & (
  | { readonly kind: "price"; readonly amount: Money }
  | { readonly kind: "delivery"; readonly amount: Money }
  | { readonly kind: "discount"; readonly adjustment: Adjustment; readonly code: string | null }
  | { readonly kind: "cashback"; readonly amount: Money; readonly programme: string }
  | { readonly kind: "points"; readonly quantity: number; readonly programme: string }
  | { readonly kind: "perk"; readonly description: string }
);
export type Offer = OfferInput & Readonly<{ id: OfferId; row: RowId }>;
export type Selection = Readonly<{
  price: OfferId; delivery: OfferId | null; benefits: readonly OfferId[];
  stackProof: readonly Proof[];
}>;
export type Line = Readonly<{
  offer: OfferId; label: string; proof: Proof; status: Status;
  value: { readonly kind: "money"; readonly amount: Money }
    | { readonly kind: "points"; readonly quantity: number }
    | { readonly kind: "description"; readonly text: string };
}>;
/** These ledgers have no shared total. No price is represented as an invented zero. */
export type PayToday =
  | { readonly kind: "known"; readonly amount: Money; readonly lines: readonly Line[] }
  | { readonly kind: "unknown"; readonly gaps: NonEmpty<string>; readonly lines: readonly Line[] };
export type BudgetFit = { readonly kind: "within" }
  | { readonly kind: "over"; readonly by: Money }
  | { readonly kind: "unknown" } | { readonly kind: "no-budget" };
export type Quote = Readonly<{
  id: QuoteId; selection: Selection; guaranteed: PayToday; budget: BudgetFit;
  conditional: readonly Readonly<{ payToday: PayToday; conditions: NonEmpty<Status>; budget: BudgetFit }>[];
  backLater: readonly Line[]; perks: readonly Line[];
}>;
export type ReadyLink = Readonly<{
  url: Url; steps: readonly Step[];
  affiliation: { readonly kind: "tagged"; readonly disclosure: string }
    | { readonly kind: "untagged"; readonly reason: string };
}>;
/** Minted from OAuth, never from tool input; writers cannot choose their authority. */
export type Agent = Readonly<{ account: AccountId; writer: WriterId; kind: "agent" }>;
export type Person = Readonly<{ account: AccountId; writer: WriterId; kind: "person";
  authority: Id<"VerifiedAppInteraction"> }>;
export type Failure = Readonly<{
  code: "invalid" | "forbidden" | "missing" | "key-reused" | "stale" | "incomplete";
  message: string; retry: "fix-input" | "refresh" | "never";
}>;
export type Result<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Failure };
