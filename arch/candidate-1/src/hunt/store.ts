import type { AccountId, EventId, HuntId, Id, NonEmpty, RequestKey, Result, Revision, WriterId } from "../domain.js";
import type { EventBody, HuntEvent } from "./index.js";

/** @internal Storage representation is private to hunt/. No public export or external deep import. */
export type Cut = Readonly<{ revision: Revision; events: NonEmpty<HuntEvent> }>;
export type Append = Readonly<{
  account: AccountId; hunt: HuntId; writer: WriterId; actor: "agent" | "person";
  requestKey: RequestKey; requestDigest: Id<"CanonicalRequestDigest">;
  after: Revision | null; body: EventBody;
}>;
/**
 * PostgreSQL immutable rows partitioned by account/hunt/writer. No shared row/head update.
 * PK(account,hunt,writer,event_id); UNIQUE(account,request_key) stores request digest + receipt.
 * Account/hunt lookup index and immutable cut-membership table support reads and exact basis checks.
 * Recent-hunt/updated-time indexes are disposable derivatives, never sources for folding.
 */
export class HuntStore {
  /** Check BEFORE reading mutable context; append repeats this atomically to close the race. */
  receipt(args: { account: AccountId; requestKey: RequestKey; requestDigest: Id<"CanonicalRequestDigest"> }): Promise<Result<EventId | null>> {
    // TODO Digest the original parsed request before evidence normalization; include operation/hunt.
    throw new Error("not implemented");
  }
  append(request: Append): Promise<Result<EventId>> {
    // TODO In one transaction reserve tenant request key, compare canonical payload digest and insert
    // TODO event + idempotency receipt. Duplicate key/different digest => key-reused, no append.
    // TODO Event ID is stable from account+requestKey; database supplies receivedAt, not causal order.
    // TODO Expand after to immutable seen IDs; only opened allows null. Actor/writer are server-minted.
    // TODO Different writers insert independent rows; racing identical requests use uniqueness only.
    throw new Error("not implemented");
  }
  read(args: { account: AccountId; hunt: HuntId; at: Revision | "latest" }): Promise<Result<Cut>> {
    // TODO Read one MVCC snapshot of all writer partitions; validate/migrate stored event envelopes.
    // TODO Hash ALL sorted IDs and retain immutable membership; at:revision returns that exact event set.
    // TODO Reject unknown/foreign revisions; retain cuts across restarts/hosts for causality validation.
    throw new Error("not implemented");
  }
  recent(args: { account: AccountId; limit: number }): Promise<readonly HuntId[]> {
    throw new Error("not implemented");
  }
  /** Privacy erasure is the only deletion path, coordinated by memory's account-erasure workflow. */
  erase(args: { account: AccountId }): Promise<void> {
    // TODO Delete events, cuts, receipts, derived indexes and encrypted backups under retention policy.
    throw new Error("not implemented");
  }
}
