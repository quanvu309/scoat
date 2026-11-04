import type { Catalog } from './catalog';
import type { Hunts } from './hunts';
import type { AccountServices } from './services';

/**
 * SDK boundary: register five agent tools, one bridge-only card action, the prompt and resources.
 * Parse unknown SDK inputs via runtime schemas into domain types; map Outcome to structured results
 * and actionable MCP errors. Obtain account identity from validated OAuth, not input. The app bridge
 * must provide a host-verifiable person gesture for card_action; disable actions when unavailable.
 * Register benefit_hunt prompt and scoat://playbooks/{id} resource from Catalog.render; expose the
 * same content as get_playbook for hosts lacking prompt/resource support. Build skill exports from
 * the same records. Register the MCP Apps UI resource for the card and attach it to hunt responses.
 * Each response includes complete text: rows, finds, evidence/status, stop, totals and next actions.
 * Iframe polls hunt(read) every few seconds via the host bridge, reconciles by returned stateVersion,
 * sends card_action(stop/skip) with a stable click requestId, and renders finished result and controls.
 * It uses ready_link for the finished destination and watch(create) for a saved item with consent.
 * Fallback hosts receive equivalent text, including explicit person skip/stop interaction only if
 * the host can attest it; no fake app authorization. Never put OAuth tokens in the iframe state.
 */
export function registerMcp(input: { catalog: Catalog; hunts: Hunts; accounts: AccountServices }): void {
  throw new Error('not implemented');
}

/** Tool contracts after parsing. SDK schemas expose equivalent JSON shapes, without domain brands.
 * get_playbook: Read the pinned/current hunt method and relevant curated facts.
 * hunt: Start, read, record, mark or finish a hunt; refusals explain the next action.
 * memory: Read or change your profile and saved items, or delete your account data.
 * watch: List, create or stop a daily price watch with email consent.
 * ready_link: Get the disclosed outbound link for a finished priced result.
 * card_action: Bridge-only person action to stop or skip; never an agent tool.
 */
export interface ToolContracts {
  get_playbook(input: { playbookId: string; playbookVersion: string | 'current'; factsVersion: string | 'current'; subjectKeys: string[] }): Promise<import('./catalog').Guidance>;
  hunt(input: import('./hunts').HuntCommand): Promise<import('./domain').Outcome<import('./hunts').HuntView>>;
  memory(input: import('./services').MemoryCommand): Promise<import('./domain').Outcome<import('./services').MemoryView>>;
  watch(input: import('./services').WatchCommand): Promise<import('./domain').Outcome<import('./services').WatchView>>;
  ready_link(input: { huntId: import('./domain').Id }): Promise<import('./domain').Outcome<import('./services').ReadyLink>>;
  card_action(input: import('./hunts').CardAction): Promise<import('./domain').Outcome<import('./hunts').HuntView>>;
}
