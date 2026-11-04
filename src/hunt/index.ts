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
export type RowView = Readonly<{
    row: Row;
    revision: RowRevision;
    state: "next" | "checking" | "done" | "skipped" | "gap";
    slots: readonly Readonly<{
        slot: number;
        state: "next" | "checking" | "done" | "gap";
        seller: string | null;
        note: string;
    }>[];
    skippedBy: "person" | null;
}>;
export type HuntView = Readonly<{
    hunt: HuntId;
    release: ReleaseId;
    intent: Intent;
    profile: Profile;
    rows: NonEmpty<RowView>;
    offers: readonly Offer[];
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
export function checkEvidence(args: {
    offer: OfferInput;
    intent: Intent;
    release: Release;
    row: Row;
    now: Instant;
}): Result<OfferInput> {
    throw new Error("not implemented");
}
export function priceQuotes(args: {
    offers: readonly Offer[];
    intent: Intent;
    release: Release;
    selection: Selection | null;
}): readonly Quote[] {
    throw new Error("not implemented");
}
export function pickBest(quotes: readonly Quote[]): Quote | null {
    throw new Error("not implemented");
}
export function finishable(rows: readonly RowView[]): {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly open: NonEmpty<RowId>;
} {
    throw new Error("not implemented");
}
export function renderView(args: {
    release: Release;
    intent: Intent;
    profile: Profile;
    rows: readonly RowView[];
    offers: readonly Offer[];
    quotes: readonly Quote[];
    stopRequested: boolean;
    final: HuntView["final"];
    ready: ReadyLink | null;
    hunt: HuntId;
}): HuntView {
    throw new Error("not implemented");
}
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
