export type Id<Tag extends string> = string & {
    readonly __brand: Tag;
};
export type AccountId = Id<"AccountId">;
export type HuntId = Id<"HuntId">;
export type RowId = Id<"RowId">;
export type OfferId = Id<"OfferId">;
export type QuoteId = Id<"QuoteId">;
export type ReleaseId = Id<"ReleaseId">;
export type FactId = Id<"FactId">;
export type ItemId = Id<"ItemId">;
export type WatchId = Id<"WatchId">;
export type RequestKey = Id<"RequestKey">;
export type Url = Id<"PublicHttpsUrl">;
export type Instant = Id<"UtcInstant">;
export type RowRevision = number & {
    readonly __brand: "RowRevision";
};
export type NonEmpty<T> = readonly [
    T,
    ...T[]
];
export type Money = Readonly<{
    currency: "GBP";
    pence: number;
}>;
export type Proof = Readonly<{
    url: Url;
    observedAt: Instant;
    note: string;
}>;
export type Step = "verify-student" | "join" | "enrol" | "activate" | "apply-code" | "request-price-match";
export type Status = {
    readonly kind: "confirmed";
} | {
    readonly kind: "needs-step";
    readonly steps: NonEmpty<Step>;
} | {
    readonly kind: "untested";
} | {
    readonly kind: "unknown";
    readonly reason: string;
};
export type Product = {
    readonly kind: "url";
    readonly url: Url;
} | {
    readonly kind: "description";
    readonly text: string;
};
export type Intent = Readonly<{
    product: Product;
    variant: string | null;
    shop: string | null;
    budget: Money | null;
}>;
export type Profile = Readonly<{
    student: "yes" | "no" | "unknown";
    cards: readonly string[];
    memberships: readonly string[];
}>;
export type Adjustment = {
    readonly kind: "fixed";
    readonly amount: Money;
} | {
    readonly kind: "percent";
    readonly basisPoints: number;
    readonly basis: "item" | "remaining" | "delivery";
};
type Attested = Readonly<{
    seller: string;
    variant: string | null;
    status: Status;
    proof: Proof;
}>;
export type OfferInput = Attested & ({
    readonly kind: "price";
    readonly amount: Money;
} | {
    readonly kind: "delivery";
    readonly amount: Money;
} | {
    readonly kind: "discount";
    readonly adjustment: Adjustment;
    readonly code: string | null;
} | {
    readonly kind: "cashback";
    readonly amount: Money;
    readonly programme: string;
} | {
    readonly kind: "points";
    readonly quantity: number;
    readonly programme: string;
} | {
    readonly kind: "perk";
    readonly description: string;
});
export type Offer = OfferInput & Readonly<{
    id: OfferId;
    row: RowId;
}>;
export type Selection = Readonly<{
    price: OfferId;
    delivery: OfferId | null;
    benefits: readonly OfferId[];
    stackProof: readonly Proof[];
}>;
export type Line = Readonly<{
    offer: OfferId;
    label: string;
    proof: Proof;
    status: Status;
    value: Money | {
        readonly points: number;
    } | {
        readonly text: string;
    };
}>;
export type PayToday = {
    readonly kind: "known";
    readonly amount: Money;
    readonly lines: NonEmpty<Line>;
} | {
    readonly kind: "unknown";
    readonly gaps: NonEmpty<string>;
    readonly lines: readonly Line[];
};
export type BudgetFit = {
    readonly kind: "within";
} | {
    readonly kind: "over";
    readonly by: Money;
} | {
    readonly kind: "unknown";
} | {
    readonly kind: "no-budget";
};
export type Quote = Readonly<{
    id: QuoteId;
    seller: string;
    selection: Selection;
    guaranteed: PayToday;
    budget: BudgetFit;
    conditional: readonly Readonly<{
        payToday: PayToday;
        requires: NonEmpty<Step>;
        budget: BudgetFit;
    }>[];
    backLater: readonly Line[];
    perks: readonly Line[];
}>;
export type ReadyLink = Readonly<{
    url: Url;
    steps: readonly Step[];
}>;
export type Agent = Readonly<{
    account: AccountId;
    client: string;
    kind: "agent";
}>;
export type Person = Readonly<{
    account: AccountId;
    kind: "person";
    grant: Id<"AppGrant">;
}>;
export type Failure = Readonly<{
    code: "invalid" | "forbidden" | "missing" | "conflict" | "key-reused" | "incomplete" | "unproven";
    message: string;
    next: string;
}>;
export type Result<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: Failure;
};
