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
  scoat_guide: { input: z.strictObject({ job: z.literal("best-benefit"), shop: text.nullable() }), description: "Complete versioned UK/GBP hunt guidance with explicit knowledge gaps.", visibility: ["model"], readOnly: true },
  scoat_hunt: { input: huntInput, description: "Record and resume durable UK/GBP hunts; Scoat calculates totals.", visibility: ["model"], readOnly: false },
  scoat_memory: { input: memoryInput, description: "Read durable profiles and saved results; propose exact browser-approved profile and save commands.", visibility: ["model"], readOnly: false },
  scoat_card: { input: cardInput, description: "Session-bound hunt read capabilities: open, read, renew and revoke. Stop and Skip require fresh browser confirmation through server-derived links.", visibility: ["app"], readOnly: false }
} satisfies Record<string, { input: z.ZodType; description: string; visibility: ("model" | "app")[]; readOnly: boolean }>;
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
export const schemas = () => Object.fromEntries(Object.entries(toolCatalog).map(([name, entry]) => [name, { ...z.toJSONSchema(entry.input, { target: "draft-7" }), type: "object" }]));
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
  return { isError: true, content: [{ type: "text" as const, text: message }], structuredContent: { ok: false, error: { code, message }, market: "GB", currency: "GBP" } };
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
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ListToolsResultSchema.parse({ tools: Object.entries(toolCatalog).map(([name, entry]) => ({ name, description: entry.description, inputSchema: schemas()[name], annotations: { readOnlyHint: entry.readOnly }, _meta: { ui: { visibility: entry.visibility, ...(name === "scoat_hunt" ? { resourceUri: appUri } : {}) } } })) }));
  server.server.setRequestHandler(CallToolRequestSchema, async request => {
    const name = request.params.name;
    const invalid = { isError: true, content: [{ type: "text" as const, text: "Invalid tool input; use the strict registry schema. Identity and calculated totals are server-owned." }] };
    if (!isToolName(name)) return invalid;
    let call: ToolCall;
    try { call = parseToolCall(name, request.params.arguments); }
    catch (error) { if (error instanceof z.ZodError) return invalid; throw error; }
    return await invoke(call);
  });
  registerAppResource(server, "Scoat live hunt", appUri, {}, async () => ({ contents: [{ uri: appUri, mimeType: RESOURCE_MIME_TYPE, text: fixtureHtml, _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }] }));
}
export function createMcpServer(invoke?: (call:ToolCall)=>CallToolResult | Promise<CallToolResult>) {
  const server = new McpServer({ name: "scoat-foundation", version: "0.1.0" });
  mount({ server, ...(invoke ? {invoke} : {}) });
  return server;
}
