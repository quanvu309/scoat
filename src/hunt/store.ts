import type { AccountId, HuntId, Instant, Intent, Offer, Profile, Quote, ReleaseId, RequestKey, RowId, RowRevision } from "../domain.js";
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
export type Receipt = Readonly<{
    account: AccountId;
    key: RequestKey;
    digest: string;
    reply: unknown;
}>;
export interface Tx {
    hunt(id: HuntId): Promise<HuntRecord | null>;
    rows(id: HuntId): Promise<readonly RowRecord[]>;
    offers(id: HuntId): Promise<readonly Offer[]>;
    putRow(row: RowRecord, expected: RowRevision): Promise<"ok" | "conflict">;
    addOffers(offers: readonly Offer[]): Promise<void>;
    putHunt(hunt: HuntRecord): Promise<void>;
    receipt(account: AccountId, key: RequestKey): Promise<Receipt | null>;
    putReceipt(receipt: Receipt): Promise<void>;
    recent(account: AccountId, limit: number): Promise<readonly HuntRecord[]>;
    erase(account: AccountId): Promise<void>;
}
export interface HuntStore {
    transact<T>(args: {
        hunt: HuntId | null;
        lockAll: boolean;
    }, run: (tx: Tx) => Promise<T>): Promise<T>;
}
export function createHuntStore(args: {
    databaseUrl: string;
}): HuntStore {
    throw new Error("not implemented");
}
