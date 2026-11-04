import type { AccountId, Agent, HuntId, Instant, ItemId, Money, Person, Profile, RequestKey, Result, WatchId } from "../domain.js";
import type { Hunts, HuntView } from "../hunt/index.js";
import type { Delivery, Recheck } from "../delivery/index.js";
export type MemoryRequest = {
    readonly op: "read";
} | {
    readonly op: "profile";
    readonly requestKey: RequestKey;
    readonly profile: Profile;
} | {
    readonly op: "save";
    readonly requestKey: RequestKey;
    readonly hunt: HuntId;
} | {
    readonly op: "watch";
    readonly requestKey: RequestKey;
    readonly hunt: HuntId;
    readonly target: Money;
} | {
    readonly op: "unwatch";
    readonly requestKey: RequestKey;
    readonly watch: WatchId;
} | {
    readonly op: "erase";
    readonly requestKey: RequestKey;
};
export type SavedItem = Readonly<{
    id: ItemId;
    hunt: HuntId;
    snapshot: HuntView;
    savedAt: Instant;
}>;
export type Watch = Readonly<{
    id: WatchId;
    item: ItemId;
    target: Money;
    state: "active" | "cancelled";
    lastCheck: Recheck | null;
    lastNotified: Money | null;
}>;
export type MemoryView = Readonly<{
    profile: Profile;
    saved: readonly SavedItem[];
    watches: readonly Watch[];
    recentHunts: readonly HuntId[];
    email: "verified" | "missing";
    text: string;
}>;
export type MemoryReply = {
    readonly kind: "state";
    readonly view: MemoryView;
} | {
    readonly kind: "erased";
};
export class Memory {
    constructor(private readonly deps: {
        hunts: Hunts;
        delivery: Delivery;
        databaseUrl: string;
    }) { }
    run(args: {
        actor: Agent | Person;
        request: MemoryRequest;
        now: Instant;
    }): Promise<Result<MemoryReply>> {
        throw new Error("not implemented");
    }
    recheckDue(args: {
        utcDay: string;
        now: Instant;
    }): Promise<void> {
        throw new Error("not implemented");
    }
    unsubscribe(args: {
        token: string;
    }): Promise<void> {
        throw new Error("not implemented");
    }
    profileOf(account: AccountId): Promise<Profile> {
        throw new Error("not implemented");
    }
}
