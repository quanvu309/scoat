import type { Instant, Money, Quote, ReadyLink, Url, WatchId } from "../domain.js";
export type Recheck = Readonly<{
    observedAt: Instant;
    url: Url;
    payToday: {
        readonly kind: "known";
        readonly amount: Money;
    } | {
        readonly kind: "unknown";
        readonly reason: string;
    };
}>;
export interface Delivery {
    readyLink(args: {
        quote: Quote;
        url: Url;
    }): Promise<ReadyLink>;
    recheck(args: {
        url: Url;
        seller: string;
        variant: string | null;
        now: Instant;
    }): Promise<Recheck>;
    email(args: {
        to: "account-verified-email";
        watch: WatchId;
        key: string;
        subject: string;
        body: string;
    }): Promise<void>;
}
export function createDelivery(args: {
    mailProvider: string;
}): Delivery {
    throw new Error("not implemented");
}
