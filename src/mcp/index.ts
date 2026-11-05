import { guideOutput, huntOutput, memoryOutput } from "./outputs.js";
import { conform, refuseInput, refusal } from "./results.js";
import { readFileSync } from "node:fs";
import { agentRequestKey } from "../hunt/request-key.js";
import { memoryInput } from "../memory/contracts.js";
import { pinnedResources } from "./resources.js";
import { moneySchema, proofSchema, offerInputSchema, compatibilitySchema, selectionSchema } from "../hunt/evidence.js";
import { Knowledge, renderGuide } from "../knowledge/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { ListToolsRequestSchema, ListToolsResultSchema, CallToolRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const text = z.string().min(1).max(2000);
const id = z.string().min(1).max(128);
export const promptInput = z.strictObject({ shop: z.string().max(2000).optional() });
const money = moneySchema;
const profile = z.strictObject({ student: z.enum(["yes", "no", "unknown"]), cards: z.array(text).max(30), memberships: z.array(text).max(30) });
const proof = proofSchema;
const offer = offerInputSchema;
const outcome = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("checking") }), z.strictObject({ kind: z.literal("found"), offers: z.array(offer).min(1).max(50) }), z.strictObject({ kind: z.literal("none"), checked: text, seller: text.optional(), proof: z.array(proof).min(1).max(20) }), z.strictObject({ kind: z.literal("gap"), reason: text })]);
export const huntInput = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("start"), requestKey: agentRequestKey, profile: profile.nullable(), intent: z.strictObject({ product: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("url"), url: z.url({ protocol: /^https$/ }) }), z.strictObject({ kind: z.literal("description"), text })]), variant: text.nullable(), shop: text.nullable(), budget: money.nullable() }) }),
  z.strictObject({ op: z.literal("list"), after: id.brand<"HuntId">().optional(), limit: z.number().int().min(1).max(20).optional() }),
  z.strictObject({ op: z.literal("read"), hunt: id }),
  z.strictObject({ op: z.literal("record"), requestKey: agentRequestKey, hunt: id, row: id, slot: z.number().int().nonnegative(), expected: z.number().int().nonnegative(), outcome }),
  z.strictObject({ op: z.literal("compatibility"), requestKey: agentRequestKey, hunt: id, evidence: compatibilitySchema }),
  z.strictObject({ op: z.literal("finish"), requestKey: agentRequestKey, hunt: id, selection: selectionSchema.nullable() })
]);

const cardInput = z.discriminatedUnion("op", [z.strictObject({ op:z.literal("open"),hunt:id.brand<"HuntId">() }), ...(["read","renew","revoke"] as const).map(op=>z.strictObject({op:z.literal(op),hunt:id.brand<"HuntId">(),grant:id.brand<"ReadGrantId">()}))]);
export const appUri = "ui://scoat/hunt.html";
export const toolCatalog = {
  scoat_guide: { title: "UK shopping method and shop facts", input: z.strictObject({ job: z.literal("best-benefit"), shop: text.nullable() }), output: guideOutput, description: 'Read Scoat’s pinned UK/GBP best-benefit method: the eight checklist rows and their slots, sourced shop facts and named knowledge gaps. Read-only. It does not search retailers or price anything. Example: {"job":"best-benefit","shop":null}.', visibility: ["model"], annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  scoat_hunt: { title: "Research and finish a shopping hunt", input: huntInput, output: huntOutput, description: 'A durable UK/GBP shopping hunt for one exact product. You research retailers. Scoat stores and checks your evidence and calculates every total; never send totals or identity. start: create a hunt (profile null uses the saved profile). list / read: resume. record: one slot outcome (found offers, none with proof, or a named gap) for row and slot, with expected set to that row’s current revision. compatibility: prove that specific offers combine. finish: when directive.kind is finish, or name-gaps-and-finish with no rows left, Scoat prices and freezes the result. Each new write uses a fresh requestKey. After an uncertain response, repeat the identical call with the same requestKey: you get the original result, then read for the latest. Stop and Skip are made by the person through the browser links in controls. Example: {"op":"read","hunt":"<id from start or list>"}.', visibility: ["model"], annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
  scoat_memory: { title: "Saved profile, results and price watches", input: memoryInput, output: memoryOutput, description: 'Account memory. read (overview, saved, recent, watches; pass next as after) and item return stored data. profile and save are proposals: the result is confirmation-required with a browser URL, and nothing changes until the person approves; then repeat the identical call from this same connection within an hour to apply it. watch proposes a price watch the person activates in the browser; afterwards read watches. unwatch cancels immediately and reports alerts that may still arrive. Example: {"op":"read","collection":"overview"}.', visibility: ["model"], annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
  scoat_card: { title: "Live hunt card refresh (app only)", input: cardInput, output: null, description: 'App-only refresh of a hunt card’s read capability: open, read, renew, revoke. No person actions. Example: {"op":"open","hunt":"<id from start or list>"}.', visibility: ["app"], annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } }
} satisfies Record<string, { title: string; input: z.ZodType; output: z.ZodType | null; description: string; visibility: ("model" | "app")[]; annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint?: boolean; openWorldHint: boolean } }>;
export type ToolName = keyof typeof toolCatalog;
export type Requests = { [K in ToolName]: z.infer<(typeof toolCatalog)[K]["input"]> };
export function isToolName(name: string): name is ToolName { return Object.hasOwn(toolCatalog, name); }
export type CardRequest = Requests["scoat_card"];
export function parseToolCall(name: ToolName, raw: unknown) {
  switch (name) {
    case "scoat_guide": return { name, input: toolCatalog.scoat_guide.input.parse(raw) };
    case "scoat_hunt": return { name, input: toolCatalog.scoat_hunt.input.parse(raw) };
    case "scoat_memory": return { name, input: toolCatalog.scoat_memory.input.parse(raw) };
    case "scoat_card": return { name, input: toolCatalog.scoat_card.input.parse(raw) };
  }
}
export type ToolCall = ReturnType<typeof parseToolCall>;
const knowledge = new Knowledge();
const releases = await knowledge.list();
const resources = pinnedResources(releases);
const release = await knowledge.read({ release: "latest" });
export const guideUri = `scoat://knowledge/${release.id}/guide`;
export const skillUri = `scoat://knowledge/${release.id}/SKILL.md`;
const huntPrompt = { name: "hunt-best-benefit", description: "Pinned complete UK/GBP hunt method", arguments: [{ name: "shop", required: false }] };
export const promptCatalog = { prompts: [huntPrompt.name], resources: resources.map(resource => resource.uri), apps: [appUri] };
export const schemas = () => Object.fromEntries(Object.entries(toolCatalog).map(([name, entry]) => [name, { ...z.toJSONSchema(entry.input, { target: "draft-7", io: "input" }), type: "object" }]));
export const descriptors = () => Object.entries(toolCatalog).map(([name, entry]) => ({
  name, title: entry.title, description: entry.description,
  inputSchema: { ...z.toJSONSchema(entry.input, { target: "draft-7", io: "input" }), type: "object" },
  ...(entry.output ? { outputSchema: { ...z.toJSONSchema(entry.output, { target: "draft-7", io: "output" }), type: "object" } } : {}),
  annotations: entry.annotations,
  _meta: { ui: { visibility: entry.visibility, ...(name === "scoat_hunt" ? { resourceUri: appUri } : {}) } },
}));
export function dispatch(name: ToolName, raw: unknown) {
  return dispatchParsed(parseToolCall(name, raw));
}
export function dispatchParsed(call: ToolCall) {
  const { name } = call;
  if (call.name === "scoat_guide") {
    const request = call.input;
    const guide = renderGuide({ release, request, format: "tool" });
    return { isError: false, content: [{ type: "text" as const, text: guide.method }], structuredContent: { ok: true, market: "GB", currency: "GBP", ...guide } };
  }
  const code = name === "scoat_card" ? "forbidden" : "unavailable";
  const message = name === "scoat_card" ? "Person authorization unavailable; visibility and grants are not authorization." : toolCatalog[name].description;
  return { isError: true, content: [{ type: "text" as const, text: message }], structuredContent: refusal(code, message, "Connect an authenticated Scoat account to continue.", { kind: "none" }).structuredContent };
}
export const fixtureHtml = readFileSync(new URL("../card/index.html",import.meta.url),"utf8");
export function mount({ server, invoke = dispatchParsed }: { server: McpServer; invoke?: (call:ToolCall)=>CallToolResult | Promise<CallToolResult> }) {
  server.server.registerCapabilities({ prompts: {} });
  server.server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [huntPrompt] }));
  server.server.setRequestHandler(GetPromptRequestSchema, async request => {
    const parsed = promptInput.safeParse(request.params.arguments ?? {});
    if (request.params.name !== huntPrompt.name || !parsed.success) throw new McpError(ErrorCode.InvalidParams, "Use hunt-best-benefit with only an optional shop argument");
    return { messages: [{ role: "user", content: { type: "text", text: renderGuide({ release, request: { job: "best-benefit", shop: parsed.data.shop ?? null }, format: "prompt" }).method } }] };
  });
  for (const resource of resources) {
    const {name,uri,mimeType,text}=resource;
    server.registerResource(name,uri,{mimeType},async()=>({contents:[{uri,mimeType,text}]}));
  }
  server.server.registerCapabilities({ tools: {} });
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ListToolsResultSchema.parse({ tools: descriptors() }));
  server.server.setRequestHandler(CallToolRequestSchema, async request => {
    const name = request.params.name;
    if (!isToolName(name)) throw new McpError(ErrorCode.InvalidParams, "Unknown tool; list tools for the four Scoat tools");
    let call: ToolCall;
    try { call = parseToolCall(name, request.params.arguments ?? {}); }
    catch (error) { if (error instanceof z.ZodError) return conform(name, refuseInput(name, error)); throw error; }
    return conform(name, await invoke(call));
  });
  registerAppResource(server, "Scoat live hunt", appUri, {}, async () => ({ contents: [{ uri: appUri, mimeType: RESOURCE_MIME_TYPE, text: fixtureHtml, _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }] }));
}
export function createMcpServer(invoke?: (call:ToolCall)=>CallToolResult | Promise<CallToolResult>) {
  const server = new McpServer({ name: "scoat-foundation", version: "0.1.0" });
  mount({ server, ...(invoke ? {invoke} : {}) });
  return server;
}
