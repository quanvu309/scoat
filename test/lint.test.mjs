import test from "node:test";
import assert from "node:assert/strict";
import { checkComments } from "../scripts/check-no-comments.mjs";
import { checkSdkImports, checkWire, checkWorkflow, checkTools, checkDependencyPair, checkPersonBoundary, checkHostConfig, checkRegistryAdapter, checkTypeConfig, checkDriver, checkKnowledgeTypes, checkReleaseSources, checkHuntAuthority, checkCandidateSearch, checkViewCoverage, checkCodeAuthority, checkScenarioProjection, checkScratchAllocation } from "../scripts/check-structure.mjs";

test("comment parser rejects comments outside src and accepts URL/regex literals", () => {
  for (const file of ["scripts/past.mjs", "test/past.ts", "vite.config.ts"]) assert.throws(() => checkComments(file, "const x = 1; /" + "/ forbidden"), /comments forbidden/);
  assert.throws(() => checkComments("ci.yaml", "jobs: {}\n# forbidden"), /comments forbidden/);
  assert.throws(() => checkComments("ci.yaml", "jobs:\n  # forbidden\n  a: {}"), /comments forbidden/);
  assert.doesNotThrow(() => checkComments("x.mjs", 'const url="https://example.com"; const re=/a\\/b/;'));
});
test("structural rules reject each offending fixture with supported fix", () => {
  assert.throws(() => checkSdkImports("src/domain.ts", 'import { Client } from "@modelcontextprotocol/sdk/client/index.js";'), /SDK-free/);
  assert.throws(() => checkSdkImports("src/server.ts", 'import { fixture } from "../fixtures/confirmation.mjs";'), /out of production/);
  assert.throws(() => checkWire({ $schema: "https://json-schema.org/draft/2020-12/schema" }), /draft-7/);
  assert.throws(() => checkWire({ type: "object", properties: {} }), /z.strictObject/);
  assert.throws(() => checkWorkflow("jobs:\n  bad:\n    runs-on: self-hosted"), /ubuntu-latest/);
  assert.throws(() => checkHostConfig('const config = {allowedHosts: ["localhost:*"]};'), /localPort/);
  const hosts = 'allowedHosts: [`localhost:${req.socket.localPort}`, `127.0.0.1:${req.socket.localPort}`]';
  assert.throws(() => checkHostConfig(`const config = {${hosts}};`), /allowedOrigins/);
  assert.throws(() => checkHostConfig(`const config = {${hosts}, allowedOrigins: []};`), /allowedOrigins/);
  assert.throws(() => checkHostConfig(`const config = {${hosts}, allowedOrigins: [\`https://attacker.invalid:\${req.socket.localPort}\`]};`), /allowedOrigins/);
  assert.throws(() => checkRegistryAdapter('registerAppTool(server, "scoat_hunt", {inputSchema: huntInput});'), /root unions/);
  assert.throws(() => checkTypeConfig({compilerOptions:{}}), /node to tsconfig/);
  assert.throws(() => checkTools(["scoat_guide", "extra"]), /four Scoat/);
  assert.throws(() => checkDependencyPair({ dependencies: { "@modelcontextprotocol/ext-apps": "2.0.4", "@modelcontextprotocol/sdk": "1.32.2" } }), /1.7.5/);
  assert.throws(() => checkPersonBoundary('export async function person(args) { return {kind:"person", grant:args.grant}; }'), /always throw/);
  assert.throws(() => checkDriver('fork("server", [], {});'), /execArgv/);
  assert.throws(() => checkDriver('export async function connect() { await client.connect(transport); }'), /Close the Client/);
});

test("knowledge stays compatible with strip-only Node tests", () => {
  assert.throws(() => checkKnowledgeTypes('export class Knowledge { constructor(readonly directory = "seed") {} }'), /erasable TypeScript/);
  assert.doesNotThrow(() => checkKnowledgeTypes('export class Knowledge { readonly directory: string; constructor(directory: string) { this.directory = directory; } }'));
});

test("prompt registration and public-source lint reject reproduced review failures", () => {
  assert.throws(() => checkRegistryAdapter("server.registerPrompt(\"hunt-best-benefit\", { description: \"Pinned complete UK/GBP hunt method\", argsSchema: { shop: z.string().optional() } }, async ({ shop }) => ({ messages: [{ role: \"user\", content: { type: \"text\", text: renderGuide({ release, request: { job: \"best-benefit\", shop: shop ?? null }, format: \"prompt\" }).method } }] }));"), /strict raw GetPromptRequestSchema/);
  assert.doesNotThrow(() => checkRegistryAdapter('server.server.setRequestHandler(GetPromptRequestSchema, handler);'));
  for (const source of ["https://127.0.0.1/code", "https://localhost/code", "https://10.0.0.1/code"]) assert.throws(() => checkReleaseSources({ facts: [{ source }] }), /public HTTPS DNS/);
  assert.doesNotThrow(() => checkReleaseSources({ facts: [{ source: "https://www.nike.com/gb/" }] }));
});

test("hunt authority rejects original unbound proof and incompatible legacy brand fixtures", () => {
  assert.throws(() => checkHuntAuthority('export type Selection = Readonly<{ price: OfferId; delivery: OfferId | null; benefits: readonly OfferId[]; stackProof: readonly Proof[] }>;'), /exact-set/);
  assert.throws(() => checkHuntAuthority('export type Id<Tag extends string> = string & { readonly __brand: Tag };'), /validated schemas/);
});

test("candidate search rejects the reproduced unsupported subset expansion", () => {
  assert.throws(() => checkCandidateSearch('candidates.sort((a,b) => key(a.benefits).localeCompare(key(b.benefits)));'), /Precompute/);
  assert.throws(() => checkCandidateSearch('const count = limitations.length ? 1 : 2 ** benefits.length;'), /authorized complete sets/);
});

test("finishability cannot lose the authoritative row universe", () => {
  assert.throws(() => checkViewCoverage('export function finishable(rows: readonly RowView[]) { return { ok: true }; }'), /pinned release/);
});

test("review lint rejects the actual source-label, missing-scenario and coverage shapes", () => {
  assert.throws(() => checkCodeAuthority('export function parseEvidence(raw: unknown, context: { intent: Intent; seller: string; now: string }) { const offer = offerInputSchema.parse(raw); if (offer.kind === "discount" && offer.code !== null && offer.codeOrigin === "lead" && offer.status.kind !== "untested") throw new Error("Third-party code leads must remain untested"); return offer; }'), /isOfficialSource/);
  assert.throws(() => checkScenarioProjection('', 'export type HuntView = Readonly<{ offers: readonly Offer[]; best: Quote | null; text: string; }>;'), /all quotes/);
  assert.throws(() => checkScenarioProjection('export type Quote = Readonly<{ conditional: readonly Readonly<{ payToday: PayToday; requires: NonEmpty<Step>; budget: BudgetFit; }>[]; }>;', ''), /selection, backLater and perks/);
  assert.throws(() => checkViewCoverage('export function finishable(rows: readonly RowView[], release: Release) { return {ok:true}; }'), /originalSeller/);
  assert.throws(() => checkViewCoverage('function rowGaps(row: RowView) { const gaps: string[] = []; for (const slot of row.row.slots) { const matches = row.slots.filter(value => value.slot === slot); } return gaps; }'), /slot membership/);
});

test("scratch lint rejects the original GitHub runner failure", () => {
  assert.throws(() => checkScratchAllocation("test/knowledge.test.ts", 'const directory = await mkdtemp(path.join(os.homedir(), "tmp/p02-test-"));'), /scratchDirectory/);
  assert.throws(() => checkScratchAllocation("scripts/verify-knowledge.mjs", 'const directory = await fs.mkdtemp(path.join(os.homedir(), "tmp/p02-live-"));'), /scratchDirectory/);
  assert.doesNotThrow(() => checkScratchAllocation("test/knowledge.test.ts", 'const directory = await scratchDirectory("p02-test-");'));
});
