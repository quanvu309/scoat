import { Knowledge, renderGuide } from "../knowledge/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { ListToolsRequestSchema, ListToolsResultSchema, CallToolRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const text = z.string().min(1).max(2000);
const id = z.string().min(1).max(128);
export const promptInput = z.strictObject({ shop: z.string().optional() });
const money = z.strictObject({ currency: z.literal("GBP"), pence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });
const profile = z.strictObject({ student: z.enum(["yes", "no", "unknown"]), cards: z.array(text).max(30), memberships: z.array(text).max(30) });
const proof = z.strictObject({ url: z.url({ protocol: /^https$/ }), observedAt: z.iso.datetime(), note: text });
const status = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("confirmed") }), z.strictObject({ kind: z.literal("needs-step"), steps: z.array(z.enum(["verify-student", "join", "enrol", "activate", "apply-code", "request-price-match"])).min(1).max(20) }), z.strictObject({ kind: z.literal("untested") }), z.strictObject({ kind: z.literal("unknown"), reason: text })]);
const attested = { seller: text, variant: text.nullable(), status, proof };
const adjustment = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("fixed"), amount: money }), z.strictObject({ kind: z.literal("percent"), basisPoints: z.number().int().min(0).max(10000), basis: z.enum(["item", "remaining", "delivery"]) })]);
const offer = z.discriminatedUnion("kind", [
  z.strictObject({ ...attested, kind: z.literal("price"), amount: money }),
  z.strictObject({ ...attested, kind: z.literal("delivery"), amount: money }),
  z.strictObject({ ...attested, kind: z.literal("discount"), adjustment, code: text.nullable() }),
  z.strictObject({ ...attested, kind: z.literal("cashback"), amount: money, programme: text }),
  z.strictObject({ ...attested, kind: z.literal("points"), quantity: z.number().int().nonnegative(), programme: text }),
  z.strictObject({ ...attested, kind: z.literal("perk"), description: text })
]);
const outcome = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("checking") }), z.strictObject({ kind: z.literal("found"), offers: z.array(offer).min(1).max(50) }), z.strictObject({ kind: z.literal("none"), checked: text, proof: z.array(proof).min(1).max(20) }), z.strictObject({ kind: z.literal("gap"), reason: text })]);
const huntInput = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("start"), requestKey: id, profile: profile.nullable(), intent: z.strictObject({ product: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("url"), url: z.url({ protocol: /^https$/ }) }), z.strictObject({ kind: z.literal("description"), text })]), variant: text.nullable(), shop: text.nullable(), budget: money.nullable() }) }),
  z.strictObject({ op: z.literal("list") }),
  z.strictObject({ op: z.literal("read"), hunt: id }),
  z.strictObject({ op: z.literal("record"), requestKey: id, hunt: id, row: id, slot: z.number().int().nonnegative(), expected: z.number().int().nonnegative(), outcome }),
  z.strictObject({ op: z.literal("finish"), requestKey: id, hunt: id, selection: z.strictObject({ price: id, delivery: id.nullable(), benefits: z.array(id).max(50), stackProof: z.array(proof).max(20) }).nullable() })
]);
const memoryInput = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("read") }), z.strictObject({ op: z.literal("profile"), requestKey: id, profile }),
  z.strictObject({ op: z.literal("save"), requestKey: id, hunt: id }), z.strictObject({ op: z.literal("watch"), requestKey: id, hunt: id, target: money }),
  z.strictObject({ op: z.literal("unwatch"), requestKey: id, watch: id }), z.strictObject({ op: z.literal("erase"), requestKey: id })
]);
const cardInput = z.discriminatedUnion("op", [z.strictObject({ op: z.literal("poll"), hunt: id, grant: id }), z.strictObject({ op: z.literal("act"), hunt: id, grant: id, requestKey: id, action: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("stop") }), z.strictObject({ kind: z.literal("skip"), row: id }), z.strictObject({ kind: z.literal("watch"), target: money })]) })]);
export const appUri = "ui://scoat/hunt.html";
export const toolCatalog = {
  scoat_guide: { input: z.strictObject({ job: z.literal("best-benefit"), shop: text.nullable() }), description: "Complete versioned UK/GBP hunt guidance with explicit knowledge gaps.", visibility: ["model"], readOnly: true },
  scoat_hunt: { input: huntInput, description: "Record agent-discovered evidence; Scoat calculates totals. Unavailable until P04.", visibility: ["model"], readOnly: false },
  scoat_memory: { input: memoryInput, description: "Account memory and requested watches. Unavailable until P06/P08.", visibility: ["model"], readOnly: false },
  scoat_card: { input: cardInput, description: "Card controls require trustworthy person authorization. Denied until authenticated confirmation exists.", visibility: ["app"], readOnly: false }
} satisfies Record<string, { input: z.ZodType; description: string; visibility: ("model" | "app")[]; readOnly: boolean }>;
export type ToolName = keyof typeof toolCatalog;
export type Requests = { [K in ToolName]: z.infer<(typeof toolCatalog)[K]["input"]> };
export function isToolName(name: string): name is ToolName { return Object.hasOwn(toolCatalog, name); }
export type CardRequest = Requests["scoat_card"];
const knowledge = new Knowledge();
const releases = await knowledge.list();
const release = await knowledge.read({ release: "latest" });
export const guideUri = `scoat://knowledge/${release.id}/guide`;
export const skillUri = `scoat://knowledge/${release.id}/SKILL.md`;
const huntPrompt = { name: "hunt-best-benefit", description: "Pinned complete UK/GBP hunt method", arguments: [{ name: "shop", required: false }] };
export const promptCatalog = { prompts: [huntPrompt.name], resources: releases.flatMap(pinned => [`scoat://knowledge/${pinned.id}/guide`, `scoat://knowledge/${pinned.id}/SKILL.md`]), apps: [appUri] };
export const schemas = () => Object.fromEntries(Object.entries(toolCatalog).map(([name, entry]) => [name, { ...z.toJSONSchema(entry.input, { target: "draft-7" }), type: "object" }]));
export function dispatch(name: ToolName, raw: unknown) {
  toolCatalog[name].input.parse(raw);
  if (name === "scoat_guide") {
    const request = toolCatalog.scoat_guide.input.parse(raw);
    const guide = renderGuide({ release, request, format: "tool" });
    return { isError: false, content: [{ type: "text" as const, text: guide.method }], structuredContent: { ok: true, market: "GB", currency: "GBP", ...guide } };
  }
  const code = name === "scoat_card" ? "forbidden" : "unavailable";
  const message = name === "scoat_card" ? "Person authorization unavailable; visibility and grants are not authorization." : toolCatalog[name].description;
  return { isError: true, content: [{ type: "text" as const, text: message }], structuredContent: { ok: false, error: { code, message }, market: "GB", currency: "GBP" } };
}
export async function authenticate(_args: unknown): Promise<never> { throw new Error("OAuth unavailable until P05"); }
export async function person(_args: unknown): Promise<never> { throw new Error("Person authorization unavailable; use authenticated same-account browser confirmation in P07"); }
export const fixtureHtml = '<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>Scoat foundation</title><p>Scoat UK/GBP fixture. Shopping and controls are unavailable.</p></html>';
export function mount({ server }: { server: McpServer }) {
  server.server.registerCapabilities({ prompts: {} });
  server.server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [huntPrompt] }));
  server.server.setRequestHandler(GetPromptRequestSchema, async request => {
    const parsed = promptInput.safeParse(request.params.arguments ?? {});
    if (request.params.name !== huntPrompt.name || !parsed.success) throw new McpError(ErrorCode.InvalidParams, "Use hunt-best-benefit with only an optional shop argument");
    return { messages: [{ role: "user", content: { type: "text", text: renderGuide({ release, request: { job: "best-benefit", shop: parsed.data.shop ?? null }, format: "prompt" }).method } }] };
  });
  for (const pinned of releases) for (const format of ["resource", "skill"] as const) {
    const uri = `scoat://knowledge/${pinned.id}/${format === "skill" ? "SKILL.md" : "guide"}`;
    server.registerResource(`${pinned.id}-${format}`, uri, { mimeType: "text/markdown" }, async () => ({ contents: [{ uri, mimeType: "text/markdown", text: renderGuide({ release: pinned, request: { job: "best-benefit", shop: null }, format }).method }] }));
  }
  server.server.registerCapabilities({ tools: {} });
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ListToolsResultSchema.parse({ tools: Object.entries(toolCatalog).map(([name, entry]) => ({ name, description: entry.description, inputSchema: schemas()[name], annotations: { readOnlyHint: entry.readOnly }, _meta: { ui: { visibility: entry.visibility, ...(name === "scoat_hunt" ? { resourceUri: appUri } : {}) } } })) }));
  server.server.setRequestHandler(CallToolRequestSchema, async request => {
    const name = request.params.name;
    if (!isToolName(name) || !toolCatalog[name].input.safeParse(request.params.arguments).success) return { isError: true, content: [{ type: "text", text: "Invalid tool input; use the strict registry schema. Identity and calculated totals are server-owned." }] };
    return dispatch(name, request.params.arguments);
  });
  registerAppResource(server, "Scoat foundation fixture", appUri, {}, async () => ({ contents: [{ uri: appUri, mimeType: RESOURCE_MIME_TYPE, text: fixtureHtml, _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }] }));
}
export function createMcpServer() {
  const server = new McpServer({ name: "scoat-foundation", version: "0.1.0" });
  mount({ server });
  return server;
}
