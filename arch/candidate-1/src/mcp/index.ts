import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodType } from "zod";
import type { Agent, HuntId, Id, Money, Person, RequestKey, Result, Revision } from "../domain.js";
import type { Guide, GuideRequest, Knowledge } from "../knowledge/index.js";
import type { Control, HuntReply, HuntRequest, Hunts, HuntView } from "../hunt/index.js";
import type { Memory, MemoryReply, MemoryRequest } from "../memory/index.js";

export type CardRequest = Readonly<{ hunt: HuntId; grant: Id<"AppOnlyGrant"> }> & (
  | { readonly op: "poll"; readonly after: Revision | null }
  | { readonly op: "act"; readonly requestKey: RequestKey;
      readonly action: Control | { readonly kind: "watch"; readonly target: Money } }
);
export type Contracts = {
  scoat_guide: { input: GuideRequest; output: Result<Guide> };
  scoat_hunt: { input: HuntRequest; output: Result<HuntReply> };
  scoat_memory: { input: MemoryRequest; output: Result<MemoryReply> };
  scoat_card: { input: CardRequest; output: Result<HuntView | MemoryReply> };
};
/** One exhaustive registry drives tools/list, permissions and descriptions; no parallel name list. */
export const toolCatalog = {
  scoat_guide: {
    visibility: ["model"], readOnly: true,
    description: "Get the current UK product-benefit playbook and sourced shop/programme facts. " +
      "Use when prompts are unavailable. The host searches; Scoat supplies the method and release ID.",
  },
  scoat_hunt: {
    visibility: ["model"], readOnly: false,
    description: "Start or resume a benefit hunt; record sourced, dated row checks or quote selections; " +
      "finish only when every row is done, person-skipped or a named gap. Returns progress, best, " +
      "person controls and text. Reuse requestKey only for exact retries. Agents cannot mark skips. " +
      "Keep conditional savings and back-later rewards separate; continue until complete or stopped.",
  },
  scoat_memory: {
    visibility: ["model"], readOnly: false,
    description: "Read/change declared student, card and membership context; list recent hunts; " +
      "save a finished hunt, watch it daily at a target price via verified account email, cancel a watch, " +
      "or erase account data. Watch only on the person's request. Never submit card numbers.",
  },
  scoat_card: {
    visibility: ["app"], readOnly: false,
    description: "App-only authenticated hunt poll or person stop/skip/watch action; not an agent tool.",
  },
} satisfies { [K in keyof Contracts]: {
  visibility: readonly ("model" | "app")[]; readOnly: boolean; description: string;
} };

/** Schemas emit MCP JSON Schema and parse wire unknown directly into branded domain values. */
export function schemas(): { [K in keyof Contracts]: {
  input: ZodType<Contracts[K]["input"]>; output: ZodType<Contracts[K]["output"]>;
} } {
  // TODO Use Zod tagged unions, transformations and verified brand guards, no unchecked casts.
  // TODO Enforce strict keys, GBP safe pence, HTTPS sources, UTC times <= server-now+clock-skew,
  // TODO nonempty reasons, bounded arrays/text, valid IDs. Reject account/writer/role supplied in input.
  // TODO Emit MCP object-root schemas with oneOf operation branches; parse with matching tagged unions.
  // TODO Output schemas validate success/error branches; isError + actionable content on failures.
  throw new Error("not implemented");
}
/** OAuth host identity maps issuer+subject to ONE account across clients; validate audience/scope. */
export function authenticate(args: { bearer: unknown; issuer: string; audience: string }): Promise<Agent> {
  // TODO Require issuer's stable Scoat-account subject across host clients; never key by email/host ID.
  // TODO Bind writer to authenticated client/session; account creation/linking belongs to the OAuth issuer.
  throw new Error("not implemented");
}
/** Grant is issued ONLY in hidden tool-result _meta to the bound app; not in model-visible state. */
export function person(args: { bridge: unknown; grant: Id<"AppOnlyGrant">; hunt: HuntId }): Promise<Person> {
  // TODO Verify bridge session, tenant, resource origin, hunt, expiry and allowed actions.
  // TODO App-only visibility alone is NOT authentication. Unsupported hosts receive read-only/text mode.
  throw new Error("not implemented");
}
export function mount(args: { server: McpServer; knowledge: Knowledge; hunts: Hunts; memory: Memory }): void {
  // TODO SDK registerTool for guide/memory; registerAppTool for hunt/card and registerAppResource from
  // TODO @modelcontextprotocol/ext-apps/server for ui://scoat/hunt.html (MIME text/html;profile=mcp-app).
  // TODO Agent tool results: structuredContent = contract output; content = complete text fallback;
  // TODO _meta.ui.resourceUri on hunt tool, app grant in result _meta, never model-visible JSON.
  // TODO Dispatch parsed inputs once to owning module. Card watch -> Memory.run, stop/skip -> Hunts.control.
  // TODO Register prompt/resourceCatalog from ./knowledge; map Guide into SDK prompt messages and
  // TODO ResourceDocument into SDK text/JSON contents. No parallel prompt, URI or skill definition.
  // TODO All transports apply OAuth and ownership; prompts/resources never bypass access checks.
  throw new Error("not implemented");
}
