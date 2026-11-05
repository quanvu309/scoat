import type { AccountId, HuntId, Instant, Intent, Profile, Quote, ReleaseId, RowId, RowRevision } from "../domain.js";
import type { SlotCompletion } from "./index.js";
export type SlotRecord = Readonly<{ slot: number; completion: SlotCompletion; seller: string | null }>;
export type RowRecord = Readonly<{
    hunt: HuntId;
    row: RowId;
    revision: RowRevision;
    slots: readonly SlotRecord[];
    skippedByPerson: Instant | null;
}>;
export type HuntRecord = Readonly<{
    id: HuntId;
    account: AccountId;
    release: ReleaseId;
    intent: Intent;
    profile: Profile;
    profileProvenance: { readonly kind: "default" | "explicit" } | { readonly kind: "declared"; readonly revision: string };
    startedAt: Instant;
    stopRequestedAt: Instant | null;
    final: {
        readonly kind: "open";
    } | {
        readonly kind: "finished";
        readonly quote: Quote | null;
        readonly at: Instant;
    };
}>;
export { PostgresHuntStore, StoreFailure } from "./postgres.js";
export type { Tx, Scope, Snapshot } from "./postgres.js";
export type HuntStore = import("./postgres.js").PostgresHuntStore;
export function createHuntStore(args: { databaseUrl: string }): HuntStore { return new PostgresHuntStore(args); }
import { PostgresHuntStore } from "./postgres.js";
