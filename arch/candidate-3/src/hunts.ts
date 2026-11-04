import type { Evidence, Find, Hunt, Id, Money, Outcome, Product, Revision, Selection } from './domain';

export type Mutation = { requestId: Id };
export type HuntCommand =
  | ({ op: 'start'; product: Product; market: 'GB'; budget?: Money } & Mutation)
  | { op: 'read'; huntId: Id }
  | ({ op: 'record'; huntId: Id; rowId: Id; expectedRevision: Revision; find: Omit<Find, 'id'> } & Mutation)
  | ({ op: 'mark'; huntId: Id; rowId: Id; expectedRevision: Revision; state: { kind: 'checking' } | { kind: 'done'; findIds: Id[]; note: string } | { kind: 'gap'; reason: string } } & Mutation)
  | ({ op: 'finish'; huntId: Id; selection: { kind: 'priced'; value: Selection } | { kind: 'unknown'; reason: string } } & Mutation);
export type CardAction = ({ op: 'stop'; huntId: Id } | { op: 'skip'; huntId: Id; rowId: Id }) & Mutation;
export type HuntView = { hunt: Hunt; card: { resourceUri: string; stateVersion: string; progress: { terminal: number; total: number }; bestSoFar: import('./domain').Result | null }; text: string };
/** Identity and person gesture proof are established by adapters, never by caller-supplied IDs. */
export type Actor = { accountId: Id; kind: 'agent' } | { accountId: Id; kind: 'person'; gesture: Id };

export interface Hunts {
  /** Owns authorization, state and idempotency. Same key and payload replay the committed response; different payload is refused. */
  execute(input: { actor: Actor; command: HuntCommand }): Promise<Outcome<HuntView>>;
  /** Only a host-attested person gesture can stop or skip; no agent impersonation. */
  cardAction(input: { actor: Actor; action: CardAction }): Promise<Outcome<HuntView>>;
}
/**
 * TODO: transact row update and request receipt together; use row CAS for concurrent writes.
 * On skip vs record, one wins; loser gets current row, never reopens a person's skip.
 * On finish, lock/check all rows and selection in one transaction; retry on concurrent changes.
 * Reject terminal row writes, dangling finds, unsupported percentages/stacking, inconsistent currencies,
 * invalid timestamps, code-site codes claimed confirmed, and unsupported seller ownership claims.
 * A confirmed code requires evidence establishing seller ownership; otherwise it is untested or unknown.
 * Calculate discounts in evidenced order using explicit bases and rounding; never infer a stack.
 * A priced result requires an evidenced product destination and confirmed price; otherwise finish with unknown and no total.
 * A person stop remains visible; agent names every unfinished row as a gap before finish.
 */
export function createHunts(): Hunts { throw new Error('not implemented'); }
/** Public evidence cannot prove private enrolment; validate the claim's provenance and applicability. */
export function validateEvidence(input: { source: Evidence; now: Evidence['observedAt'] }): Outcome<Evidence> { throw new Error('not implemented'); }
