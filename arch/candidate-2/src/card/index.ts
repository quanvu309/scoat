import type { Control, HuntView } from "../hunt/index.js";
import type { HuntId, Pence, RequestId, Revision } from "../core/index.js";
/** Same projection powers interactive card and every textual tool response. */
export interface CardModel {
  readonly hunt: HuntView;
  readonly poll: { readonly tool: "scoat_hunt"; readonly huntId: HuntId; readonly afterRevision: Revision; readonly intervalMs: 3000 };
  readonly actions: readonly ("stop" | "skip" | "open-ready-link" | "watch")[];
}
export type CardAction = { readonly kind: "control"; readonly requestId: RequestId; readonly action: Control }
  | { readonly kind: "watch"; readonly requestId: RequestId; readonly target: Pence; readonly email: string }
  | { readonly kind: "open-ready-link" };
/** Render iframe with MCP Apps bridge. Calls app.callServerTool; no direct fetch or OAuth token.
 * Stop/skip use scoat_control; watch uses scoat_watch and explicit email consent.
 * Open ready uses host-approved external navigation. Disable edits on terminal hunts.
 * No pricing/checklist logic in UI; unchanged poll response retains last revision.
 */
export function mount(input: { root: HTMLElement; initial: CardModel }): () => void {
  // TODO Init bridge; poll while visible, back off on failure, dispose timer on unmount.
  // TODO Preserve requestId on retries; render conflict by rereading canonical projection.
  throw new Error("not implemented");
}
/** Includes progress, every row/state, gaps, proof per price line, guaranteed/conditional
 * pay today, back later, budget excess, unmet steps, affiliate link and action instructions.
 */
export function textFallback(view: HuntView): string { throw new Error("not implemented"); }
