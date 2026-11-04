import type { Agent, Failure, HuntId, Instant, Intent, NonEmpty, Offer, OfferInput, Person, Profile, Proof, Quote, ReadyLink, ReleaseId, RequestKey, Result, RowId, RowRevision, Selection, } from "../domain.js";
import type { Knowledge, Release, Row } from "../knowledge/index.js";
import type { Delivery } from "../delivery/index.js";
import type { HuntStore } from "./store.js";
export type CheckOutcome = {
    readonly kind: "checking";
} | {
    readonly kind: "found";
    readonly offers: NonEmpty<OfferInput>;
} | {
    readonly kind: "none";
    readonly checked: string;
    readonly proof: NonEmpty<Proof>;
} | {
    readonly kind: "gap";
    readonly reason: string;
};
export type HuntRequest = {
    readonly op: "start";
    readonly requestKey: RequestKey;
    readonly intent: Intent;
    readonly profile: Profile | null;
} | {
    readonly op: "read";
    readonly hunt: HuntId;
} | {
    readonly op: "list";
} | {
    readonly op: "record";
    readonly requestKey: RequestKey;
    readonly hunt: HuntId;
    readonly row: RowId;
    readonly slot: number;
    readonly expected: RowRevision;
    readonly outcome: CheckOutcome;
} | {
    readonly op: "finish";
    readonly requestKey: RequestKey;
    readonly hunt: HuntId;
    readonly selection: Selection | null;
};
export type Control = {
    readonly kind: "stop";
} | {
    readonly kind: "skip";
    readonly row: RowId;
};
export type SlotCompletion = { readonly kind: "pending" } | { readonly kind: "checked"; readonly proof: NonEmpty<Proof>; readonly offers: readonly Offer["id"][] } | { readonly kind: "gap"; readonly reason: string };
export type RowView = Readonly<{
    row: Row;
    revision: RowRevision;
    skippedBy: "person" | null;
    slots: readonly Readonly<{ slot: number; seller: string | null; completion: SlotCompletion }>[];
}>;
export type HuntView = Readonly<{
    hunt: HuntId;
    release: ReleaseId;
    intent: Intent;
    profile: Profile;
    rows: NonEmpty<RowView>;
    offers: readonly Offer[];
    quotes: readonly Quote[];
    gaps: readonly string[];
    progress: {
        readonly resolved: number;
        readonly total: number;
    };
    best: Quote | null;
    final: {
        readonly kind: "open";
    } | {
        readonly kind: "finished";
        readonly quote: Quote | null;
    };
    stopRequested: boolean;
    ready: ReadyLink | null;
    directive: {
        readonly kind: "continue";
        readonly rows: NonEmpty<RowId>;
    } | {
        readonly kind: "name-gaps-and-finish";
        readonly rows: readonly RowId[];
    } | {
        readonly kind: "finish";
    } | {
        readonly kind: "complete";
    };
    text: string;
}>;
export type HuntReply = Readonly<{
    view: HuntView;
}>;
export { checkEvidence, assertRecordAllowed } from "./evidence.js";
export { priceQuotes, pickBest } from "./pricing.js";
export { finishable, renderView } from "./view.js";
export class Hunts {
    constructor(private readonly deps: {
        store: HuntStore;
        knowledge: Knowledge;
        delivery: Delivery;
        profileOf: (agent: Agent) => Promise<Profile>;
    }) { }
    run(args: {
        agent: Agent;
        request: HuntRequest;
        now: Instant;
    }): Promise<Result<HuntReply | {
        readonly hunts: readonly HuntView[];
    }>> {
        throw new Error("not implemented");
    }
    control(args: {
        person: Person;
        hunt: HuntId;
        requestKey: RequestKey;
        control: Control;
        now: Instant;
    }): Promise<Result<HuntReply>> {
        throw new Error("not implemented");
    }
    inspect(args: {
        person: Person;
        hunt: HuntId;
    }): Promise<Result<HuntView>> {
        throw new Error("not implemented");
    }
    finished(args: {
        account: Agent["account"];
        hunt: HuntId;
    }): Promise<Result<HuntView>> {
        throw new Error("not implemented");
    }
    erase(args: {
        account: Agent["account"];
    }): Promise<void> {
        throw new Error("not implemented");
    }
}
export type { Failure };
