import type { Evidence, Id } from './domain';

/** The ordered row definitions are the only checklist source; slots expand deterministically. */
export type Playbook = {
  id: string; version: string; title: string; instructions: string;
  rows: { key: string; label: string; slots: number; guidance: string; factKeys: string[] }[];
};
export type Fact = { key: string; subject: string; text: string; sources: Evidence[] };
export type FactSet = { version: string; facts: Fact[] };
export type Guidance = { playbook: Playbook; facts: FactSet };

/** Immutable versions; a hunt pins revisions, and exports/prompts/checklists derive from these records. */
export interface Catalog {
  get(input: { playbookId: string; playbookVersion: string | 'current'; factsVersion: string | 'current'; subjectKeys: string[] }): Promise<Guidance>;
  render(input: { guidance: Guidance; format: 'prompt' | 'resource' | 'skill' }): string;
  // TODO: deterministically expand row keys and slots into stable IDs unique within a hunt.
  rowIds(input: { playbook: Playbook; huntId: Id }): Id[];
}
export function createCatalog(): Catalog { throw new Error('not implemented'); }
