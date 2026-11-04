import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Human, HuntId, Pence, Product, Principal, ReleaseId, RequestId, Revision } from "../core/index.js";
import type { Advance, AdvanceReply, Control, HuntView } from "../hunt/index.js";
import type { MemoryChange, MemoryView } from "../memory/index.js";
import type { WatchAction, WatchView } from "../watch/index.js";
import type { Failure } from "../core/index.js";
/** Transport-local contracts. JSON schemas erase brands to validated primitives; domain
 * owners never import SDK, MCP envelope or app bridge types. No user-supplied principal.
 */
interface Calls {
  readonly scoat_advance: { readonly input: { readonly requestId: RequestId; readonly command: Advance }; readonly output: AdvanceReply };
  readonly scoat_hunt: { readonly input:
    { readonly kind: "read"; readonly huntId: HuntId; readonly afterRevision: Revision | null }
    | { readonly kind: "list"; readonly cursor: string | null };
    readonly output: HuntView | { readonly kind: "unchanged" }
      | { readonly hunts: readonly HuntView[]; readonly nextCursor: string | null } | Failure };
  readonly scoat_playbook: { readonly input: { readonly release: ReleaseId | "latest"; readonly product: Product | null; readonly subject: string | null };
    readonly output: { readonly release: ReleaseId; readonly text: string; readonly factsUri: string; readonly programUri: string } };
  readonly scoat_control: { readonly input: { readonly requestId: RequestId; readonly huntId: HuntId; readonly action: Control }; readonly output: HuntView | Failure };
  readonly scoat_memory: { readonly input: { readonly kind: "read" }
    | { readonly kind: "change"; readonly requestId: RequestId; readonly expected: Revision; readonly change: MemoryChange };
    readonly output: MemoryView | { readonly kind: "erased" } | Failure };
  readonly scoat_watch: { readonly input: { readonly kind: "list" }
    | { readonly kind: "change"; readonly requestId: RequestId; readonly action: WatchAction };
    readonly output: readonly WatchView[] | WatchView | Failure };
}
type ToolName = keyof Calls;
interface Definition { readonly description: string; readonly authority: "agent" | "human-on-write"; readonly readOnly: boolean }
/** One authoritative registry; schemas generated from Calls, never a second handwritten union. */
const definitions = {
  scoat_advance: { description: "Start a benefit hunt or submit ticket-bound proof. Execute returned work exactly; submit a named gap when blocked. Request next to resume or claim independent work. Never calculate a final result yourself.", authority: "agent", readOnly: false },
  scoat_hunt: { description: "Read or list your hunts across hosts. Returns checklist, best proved and conditional prices, next state and text fallback. Poll with revision for live updates.", authority: "agent", readOnly: true },
  scoat_playbook: { description: "Read the versioned benefit-hunt method and relevant public benefit facts. Use when host prompts or skills are unavailable. This does not advance a hunt.", authority: "agent", readOnly: true },
  scoat_control: { description: "Apply a person's Stop here or Skip a place decision. Requires authenticated human interaction; agents cannot authorize their own skip. Returns current hunt.", authority: "human-on-write", readOnly: false },
  scoat_memory: { description: "Read profile and saved items; with human consent update profile, save or forget items, or erase the account and all its data. Writes use revision checks.", authority: "human-on-write", readOnly: false },
  scoat_watch: { description: "List watches or, with human consent, watch a completed hunt for a target pay-today price, verify alert email, or cancel. Rechecks public links daily; no payments.", authority: "human-on-write", readOnly: false },
} satisfies Record<ToolName, Definition>;
/** OAuth subject maps to account; durable client actor ID scopes retries across reconnections.
 * App-origin/human attestation is trusted transport context, not a model-supplied boolean.
 * Unsupported text hosts cannot mutate human-only state; explain limitation in text fallback.
 */
interface Context { readonly principal: Principal; readonly human: Human | null; readonly apps: boolean }
/** The SDK and MCP Apps extension are confined here. Sketch leaves SDK registration details
 * to implementation; no assumed nonstandard SDK methods form part of the domain interface.
 */
export function register(server: McpServer): void {
  // TODO Generate structural JSON schemas from Calls/Proofs; brands map to constrained scalars.
  // TODO Parse unknown, enforce OAuth ownership, human authority, bounds and domain refinements.
  // TODO Register six tools; mark control app-only unless trusted host confirmation is supported.
  // TODO Mutating memory/watch branches require human context, including deletion confirmation.
  // TODO Every tool returns text content + structuredContent; UI-capable hunt results attach
  // TODO _meta.ui.resourceUri = ui://scoat/hunt; use MCP Apps resource MIME and registerAppTool.
  // TODO Register scoat_hunt prompt(product URL?, release?) from Knowledge.explain.
  // TODO Register immutable scoat://releases/{release}/playbook and /facts/{subject} resources.
  // TODO Register scoat://releases/{release}/SKILL.md from the same program renderer.
  // TODO Register ui://scoat/hunt bundled iframe; restrictive CSP, bridge-only data access.
  // TODO Alias latest resolves to an immutable release URI; hunt always uses its pinned release.
  throw new Error("not implemented");
}
/** Single transport dispatcher: no parallel business logic in app tools or text tools. */
async function dispatch<K extends ToolName>(input: { name: K; raw: unknown; context: Context }): Promise<Calls[K]["output"]> {
  throw new Error("not implemented");
}
