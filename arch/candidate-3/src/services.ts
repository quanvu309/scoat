import type { Evidence, Hunt, Id, Money, Outcome, Product, Url } from './domain';
import type { Mutation } from './hunts';

export type Profile = { student: 'yes' | 'no' | 'unknown'; cards: string[]; memberships: string[] };
export type SavedItem = { id: Id; product: Product; huntId: Id | null };
export type MemoryCommand = { op: 'read' } | ({ op: 'set_profile'; profile: Profile } & Mutation)
  | ({ op: 'save'; product: Product; huntId: Id | null } & Mutation)
  | ({ op: 'remove'; itemId: Id } & Mutation) | ({ op: 'delete_all' } & Mutation);
export type MemoryView = { profile: Profile; saved: SavedItem[] };
export type Watch = { id: Id; itemId: Id; target: Money; email: string; state: 'active' | 'paused'; lastChecked: Evidence | null };
export type WatchCommand = { op: 'list' }
  | ({ op: 'create'; itemId: Id; target: Money; email: string; emailConsent: true } & Mutation)
  | ({ op: 'stop'; watchId: Id } & Mutation);
export type WatchView = { watches: Watch[] };
export type ReadyLink = { url: Url; disclosure: string; tagged: boolean };

export interface AccountServices {
  /** Account-scoped, authenticated and idempotent; delete_all also cancels watches and erases hunts. */
  memory(input: { accountId: Id; command: MemoryCommand }): Promise<Outcome<MemoryView>>;
  /** Create only with explicit email consent; target compares evidenced pay-today, never cashback. */
  watch(input: { accountId: Id; command: WatchCommand }): Promise<Outcome<WatchView>>;
  /** Only the selected evidenced destination of a finished hunt; tag when a supported affiliate network permits it. */
  readyLink(input: { accountId: Id; huntId: Id }): Promise<Outcome<ReadyLink>>;
  /**
   * TODO: claim daily due jobs with a durable lease; fetch only supported public pages safely.
   * Parse a current evidenced pay-today price; unknown/blocked pages do not trigger an email.
   * Compare target and last notified price; persist observation and deterministic notification key
   * in a transactional outbox. Retry delivery using provider idempotency, suppress duplicate alerts.
   * Stops/deletions cancel outstanding work; never promise exactly-once email without provider support.
   */
  runDueWatches(input: { now: Evidence['observedAt'] }): Promise<void>;
}
export function createAccountServices(): AccountServices { throw new Error('not implemented'); }
/** Destination must belong to the finished result; never create a checkout or make a payment. */
export function destination(input: { hunt: Hunt }): Outcome<Url> { throw new Error('not implemented'); }
