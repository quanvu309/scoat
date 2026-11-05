import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkComments } from "../scripts/check-no-comments.mjs";
import { checkSdkImports, checkWire, checkWorkflow, checkTools, checkDependencyPair, checkPersonBoundary, checkHostConfig, checkRegistryAdapter, checkTypeConfig, checkDriver, checkKnowledgeTypes, checkReleaseSources, checkHuntAuthority, checkCandidateSearch, checkViewCoverage, checkCodeAuthority, checkScenarioProjection, checkScratchAllocation } from "../scripts/check-structure.mjs";

test("comment parser rejects comments outside src and accepts URL/regex literals", () => {
  for (const file of ["scripts/past.mjs", "test/past.ts", "vite.config.ts"]) assert.throws(() => checkComments(file, "const x = 1; /" + "/ forbidden"), /comments forbidden/);
  assert.throws(() => checkComments("ci.yaml", "jobs: {}\n# forbidden"), /comments forbidden/);
  assert.throws(() => checkComments("ci.yaml", "jobs:\n  # forbidden\n  a: {}"), /comments forbidden/);
  assert.doesNotThrow(() => checkComments("x.mjs", 'const url="https://example.com"; const re=/a\\/b/;'));
});

test("browser flow starts cannot mix the application and database clocks",async()=>{
 const {checkBrowserFlowClock}=await import("../scripts/check-structure.mjs");
 const issuer=readFileSync(new URL("../src/auth/issuer.ts",import.meta.url),"utf8"),flows=readFileSync(new URL("../src/auth/flows.ts",import.meta.url),"utf8");
 assert.doesNotThrow(()=>checkBrowserFlowClock(issuer,flows));
 assert.throws(()=>checkBrowserFlowClock(issuer.replace("{ verifier, nonce, browser: digest(browser), context }","{ initiatedAt: Date.now(), verifier, nonce, browser: digest(browser), context }"),flows),/database clock/);
 assert.throws(()=>checkBrowserFlowClock(issuer,flows.replace("clock_timestamp()","now()")),/database clock/);
 for (const confirmation of issuer.matchAll(/\{\s*\.\.\.flow,\s*context:/g)) {
  const original=confirmation[0];
  for (const replacement of [original.replace("...flow,","...flow, initiatedAt: Date.now(),"),original.replace("...flow,","")]) assert.throws(()=>checkBrowserFlowClock(issuer.slice(0,confirmation.index)+replacement+issuer.slice(confirmation.index+original.length),flows),/preserve that start/);
 }
 assert.throws(()=>checkBrowserFlowClock(issuer,flows.replace("value.initiatedAt ?? ","")),/preserve that start/);
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
  assert.throws(() => checkPersonBoundary('export async function person(args) { return {kind:"person", grant:args.grant}; }'), /Legacy person mint/);
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

test("P05 evidence rejects the original shallow hosted checkout", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yaml", import.meta.url), "utf8");
  const start = workflow.indexOf("  protocol:\n");
  const original = workflow.slice(0, start) + workflow.slice(start).replace("        with:\n          fetch-depth: 0\n", "");
  assert.notEqual(original, workflow);
  assert.throws(() => checkWorkflow(original), /fetch-depth: 0/);
  assert.doesNotThrow(() => checkWorkflow(workflow));
});

test("P05 rejects the original unauthenticated server and public authority constructors", async()=>{
  const {checkRemoteBoundary,checkPublicAuthority,checkGrantRenewal,checkConsentDecision}=await import("../scripts/check-structure.mjs");
  assert.throws(()=>checkConsentDecision('if (req.method !== "POST" || req.headers.origin !== issuer || submitted.get("csrf") !== csrf) { throw new Error("refused"); }'),/explicit allow or deny/);
  assert.throws(()=>checkRemoteBoundary('const server=createMcpServer();'),/verified issuer/);
  assert.throws(()=>checkPublicAuthority('export { authenticate, person, mount } from "./mcp/index.js";'),/public barrel/);
  assert.throws(()=>checkGrantRenewal('class Grants { async use() { if(op==="renew") return this.open(principal,hunt); } }'),/atomically/);
  assert.throws(()=>checkGrantRenewal('class ReadGrants { async open() { const result = await this.pool.query("INSERT INTO oauth_read_grants SELECT account FROM hunt_accounts WHERE NOT erased"); return result; } }'),/Fence capability/);
});


test("P05 review guards reject the reproduced boundary bypasses", async () => {
  const {checkRemoteBoundary,checkPublicAuthority,checkGrantRenewal,checkConsentDecision,checkAuthorizationPolicy,checkLinkRetirement,checkAuthVerification,checkBrowserLink} = await import("../scripts/check-structure.mjs");
  const server = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  const issuer = readFileSync(new URL("../src/auth/issuer.ts", import.meta.url), "utf8");
  const link = readFileSync(new URL("../src/auth/link.ts", import.meta.url), "utf8");
  for (const injected of ["allowedOrigins.push(String(req.headers.origin));", "allowedHosts.push(String(req.headers.host));", "const alias = allowedOrigins; alias.push(auth.issuer);"]) {
    assert.throws(() => checkHostConfig(server.replace("    res.setHeader", injected + "\n    res.setHeader")), /immutable/);
  }
  assert.throws(() => checkRemoteBoundary('const x="Authentication is not configured"; async function h(){ try { await auth.authenticate(req); } catch {} const server=createMcpServer(); }'), /verified issuer/);
  assert.throws(() => checkRemoteBoundary(server.replace("authenticatedDispatch(store, principal, auth.issuer, codec?.links.bind(codec), watches?.available === true)", "authenticatedDispatch(store, ignored, auth.issuer, codec?.links.bind(codec), watches?.available === true)")), /verified issuer/);
  assert.throws(() => checkRemoteBoundary(server.replace("res.end(\"Authentication is not configured\");\n      return;", "res.end(\"Authentication is not configured\");")), /Fail closed/);
  for (const value of ['export * from "./auth/identity.js";', 'export { principalFor as safe } from "./auth/identity.js";']) assert.throws(() => checkPublicAuthority(value), /public barrel/);
  assert.doesNotThrow(() => checkPublicAuthority('export type * from "./auth/issuer.js";'));
  assert.throws(() => checkGrantRenewal('/* NOT erased FOR SHARE */ class ReadGrants { async open(){ const p=this.pool; return p.query("INSERT INTO oauth_read_grants VALUES(1)"); } }'), /Fence capability/);
  assert.throws(() => checkConsentDecision('const ok=["allow","deny"].includes(submitted.get("decision") ?? ""); await provider.interactionFinished(req,res,{consent:{}});'), /explicit allow or deny/);
  assert.throws(() => checkConsentDecision(issuer.replace("!decision.success", "false")), /explicit allow or deny/);
  assert.throws(() => checkAuthorizationPolicy('const provider = new Provider(issuer, {}); if(url.pathname === "/auth" && !url.searchParams.get("state")) throw new Error("invalid");'), /parsed-parameter/);
  assert.throws(() => checkAuthorizationPolicy(issuer.replace('scopes: ["openid"],', 'scopes: ["openid", "offline_access"],')), /shipped authorization-code/);
  assert.throws(() => checkAuthorizationPolicy(issuer.replace('userinfo: { enabled: false }', 'userinfo: { enabled: true }')), /unused issuer endpoints/);
  assert.throws(() => checkAuthorizationPolicy(issuer.replace('registration: { enabled: false }', 'registration: { enabled: true }')), /unused issuer endpoints/);
  assert.throws(() => checkLinkRetirement(link.replace('"UPDATE hunt_accounts SET erased=true,erased_at=now() WHERE account=$1 AND incarnation=$2"', '"SELECT 1"')), /Retire the old account/);
  assert.doesNotThrow(() => checkConsentDecision(issuer));
  assert.doesNotThrow(() => checkConsentDecision(issuer.replace("!decision.success", '!z.enum(["allow","deny"]).safeParse(submitted.get("decision")).success')));
  assert.throws(() => checkRemoteBoundary(server.replace("!(error instanceof InvalidCredential)", "false")), /infrastructure failures/);
  assert.throws(() => checkAuthorizationPolicy(issuer.replace('throw new errors.InvalidTarget("Explicit resource required");', 'return resource;')), /missing explicit resource/);
  assert.throws(() => checkBrowserLink(issuer.replace('url.pathname === "/account/link"', 'url.pathname === "/account/unavailable"')), /Start linking in a browser/);
  assert.throws(() => checkBrowserLink(issuer.replace('DELETE FROM oauth_browser_flows WHERE state=$1 AND expires_at>now() RETURNING data', 'SELECT data FROM oauth_browser_flows WHERE state=$1')), /browser-bound confirmation/);
  assert.throws(() => checkBrowserLink(issuer.replaceAll("digest(browser) !== flow.browser", "false")), /browser-bound confirmation/);
  const skill = readFileSync(new URL("../.agents/skills/verify-scoat/SKILL.md", import.meta.url), "utf8");
  const index = readFileSync(new URL("../.agents/skills/verify-scoat/features/README.md", import.meta.url), "utf8");
  assert.throws(() => checkAuthVerification(skill.replace("features/auth.md", "features/foundation.md"), index), /Route OAuth/);
  assert.throws(() => checkAuthVerification("---\ndescription: excludes OAuth\n---\n## Completion", index), /Route OAuth/);
});


test("P05 guards reject residual alias, result and dead-condition bypasses", async () => {
  const {checkRemoteBoundary,checkPublicAuthority,checkGrantRenewal,checkConsentDecision} = await import("../scripts/check-structure.mjs");
  const server = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  const issuer = readFileSync(new URL("../src/auth/issuer.ts", import.meta.url), "utf8");
  const grants = readFileSync(new URL("../src/auth/grants.ts", import.meta.url), "utf8");
  const replace = (source, from, to) => {
    assert.ok(source.includes(from), `Missing mutation target: ${from}`);
    const changed = source.replace(from, to);
    assert.notEqual(changed, source);
    return changed;
  };
  const open = "async open(principal: Principal, hunt: HuntId) {";
  for (const access of ['const { pool } = this; await pool.query("SELECT 1");', 'await this["pool"].query("SELECT 1");']) {
    assert.throws(() => checkGrantRenewal(replace(grants, open, open + access)), /Fence capability/);
  }
  for (const value of [
    'import { createIssuer } from "./auth/issuer.js"; export { createIssuer };',
    'import { createIssuer as issue } from "./auth/issuer.js"; export { issue as safe };',
    'import * as a from "./auth/issuer.js"; export { a };',
    'import { createIssuer as issue } from "./auth/issuer.js"; export default issue;',
    'import { createIssuer as issue } from "./auth/issuer.js"; export const leak = issue;',
  ]) assert.throws(() => checkPublicAuthority(value), /public barrel/);
  assert.doesNotThrow(() => checkPublicAuthority('import type { Principal } from "./auth/issuer.js"; export type { Principal };'));
  assert.throws(() => checkRemoteBoundary(replace(server, "return await invoke(call);", "void invoke(call); return dispatchParsed(call);")), /verified issuer/);
  assert.throws(() => checkRemoteBoundary(replace(server, "const invoke = authenticatedDispatch(store, principal, auth.issuer, codec?.links.bind(codec), watches?.available === true);", "principal = forged; const invoke = authenticatedDispatch(store, principal, auth.issuer, codec?.links.bind(codec), watches?.available === true);")), /verified issuer/);
  const parser = 'const decision = z.enum(["allow", "deny"]).safeParse(submitted.get("decision"));';
  const named = replace(issuer, parser, 'const decisionSchema = z.enum(["allow", "deny"]); const decision = decisionSchema.safeParse(submitted.get("decision"));');
  assert.doesNotThrow(() => checkConsentDecision(named));
  const renamed = replace(replace(issuer, parser, 'const choice = z.enum(["allow", "deny"]).safeParse(submitted.get("decision")); const decision = choice;'), "!decision.success", "!choice.success");
  assert.doesNotThrow(() => checkConsentDecision(renamed));
  assert.throws(() => checkConsentDecision(replace(issuer, "!decision.success", "(false && !decision.success)")), /explicit allow or deny/);
  for (const assignment of ["[principal] = [forged];", "({ principal } = forged);"]) assert.throws(() => checkRemoteBoundary(replace(server, "const invoke = authenticatedDispatch(store, principal, auth.issuer, codec?.links.bind(codec), watches?.available === true);", assignment + "const invoke = authenticatedDispatch(store, principal, auth.issuer, codec?.links.bind(codec), watches?.available === true);")), /verified issuer/);
  const rejection = issuer.slice(issuer.indexOf("        if (\n          req.method"), issuer.indexOf('        if (decision.data === "deny")'));
  assert.ok(rejection.includes("!decision.success"));
  assert.throws(() => checkConsentDecision(replace(issuer, rejection, "if (false) {" + rejection + "}")), /explicit allow or deny/);
  assert.doesNotThrow(() => checkRemoteBoundary(server));
  assert.doesNotThrow(() => checkGrantRenewal(grants));
});


test("P05 disables unsupported DPoP and preserves candidate linking refusals", async () => {
  const {checkAuthorizationPolicy,checkLinkRetirement} = await import("../scripts/check-structure.mjs");
  const issuer = readFileSync(new URL("../src/auth/issuer.ts", import.meta.url), "utf8");
  const link = readFileSync(new URL("../src/auth/link.ts", import.meta.url), "utf8");
  for (const change of ["", "dPoP: { enabled: true },"]) {
    assert.ok(issuer.includes("dPoP: { enabled: false },"));
    assert.throws(() => checkAuthorizationPolicy(issuer.replace("dPoP: { enabled: false },", change)), /unused issuer endpoints/);
  }
  for (const name of ["hunts", "others"]) {
    assert.ok(link.includes(`if (${name}.rowCount)`));
    for (const condition of ["false", `false && ${name}.rowCount`]) assert.throws(() => checkLinkRetirement(link.replace(`if (${name}.rowCount)`, `if (${condition})`)), /Refuse candidate accounts/);
  }
  assert.doesNotThrow(() => checkLinkRetirement(link));
});

test("P06 ownership and enrollment guards reject the original unsafe shapes", async () => {
 const {checkErasureCoordinator,checkExplicitEnrollment,checkMemoryVerification}=await import("../scripts/check-structure.mjs");
 const coordinator=readFileSync(new URL("../src/accounts/erasure.ts",import.meta.url),"utf8");
 for (const port of ["deleteAuthentication","deleteWatches","deleteMemory","deleteHunts"]) {
  assert.ok(coordinator.includes("await "+port+"(client,scope"));
  assert.throws(()=>checkErasureCoordinator(coordinator.replace("await "+port+"(client,scope","void "+port+"(client,scope")),/fixed owner deletion/);
 }
 assert.throws(()=>checkErasureCoordinator(coordinator.replace("NOT erased FOR UPDATE","NOT erased FOR SHARE")),/exclusive active account fence/);
 const original='async function resolveIdentity() { await client.query("INSERT INTO hunt_accounts(account,incarnation) VALUES($1,$2)",[]); }';
 assert.throws(()=>checkExplicitEnrollment(original),/explicit browser enrollment/);
 assert.doesNotThrow(()=>checkExplicitEnrollment(readFileSync(new URL("../src/auth/identity.ts",import.meta.url),"utf8")));
 assert.doesNotThrow(()=>checkErasureCoordinator(coordinator));
 const recheck='if (identities.rows.some(identity => !lockedSubjects.has(JSON.stringify([identity.issuer,identity.subject])))) throw new SerializationConflict("Identity inventory changed");';
 const lock='for (const subject of lockedSubjects) await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[subject]);';
 const tombstone=`await client.query("INSERT INTO account_suppression(account,incarnation,subject_digest,key_version,erased_at,purge_after) VALUES($1,$2,$3,$4,clock_timestamp(),clock_timestamp()+interval '31 days')", [...prefix,pseudonym,keyVersion]);`;
 for (const statement of [recheck,lock,tombstone]) {
  assert.ok(coordinator.includes(statement));
  for (const replacement of ["", "if (false) {"+statement+"}", "function unused(){"+statement.replaceAll("await ","void ")+"}"]) {
   assert.throws(()=>checkErasureCoordinator(coordinator.replace(statement,replacement)),/inventory recheck/);
  }
 }
 assert.throws(()=>checkErasureCoordinator(coordinator.replace("const prefix = [scope.account,scope.incarnation]","const prefix = [other.account,scope.incarnation]")),/exclusive active account fence/);
 assert.throws(()=>checkErasureCoordinator(coordinator.replaceAll("clock_timestamp()","now()")),/suppression tombstones/);
 assert.throws(()=>checkErasureCoordinator(coordinator.replace("export async function eraseAccount", "async function unusedErasure")),/fixed owner deletion/);
 for (const sql of ["INSERT INTO hunt_accounts(account) VALUES($1)"," INSERT INTO oauth_identities VALUES($1)","INSERT INTO public.hunt_accounts VALUES($1)","WITH x AS (INSERT INTO oauth_identities VALUES($1) RETURNING *) SELECT * FROM x"]) {
  for (const delimiter of ['"','`']) assert.throws(()=>checkExplicitEnrollment("async function resolveIdentity(){await pool.query("+delimiter+sql+delimiter+");}"),/explicit browser enrollment/);
 }
 assert.throws(()=>checkMemoryVerification("---\ndescription: P05\n---",""),/features\/memory.md/);
 const skill=readFileSync(new URL("../.agents/skills/verify-scoat/SKILL.md",import.meta.url),"utf8"),index=readFileSync(new URL("../.agents/skills/verify-scoat/features/README.md",import.meta.url),"utf8");
 assert.throws(()=>checkMemoryVerification(skill.replace("For identity linking, also load [memory and erasure](features/memory.md)",""),index),/linking/);
 assert.doesNotThrow(()=>checkMemoryVerification(skill,index));
});

test("P06 exposes browser recovery and rejects links started before erasure", async () => {
 const {checkEraseRecovery,checkLinkSuppression}=await import("../scripts/check-structure.mjs");
 const issuer=readFileSync(new URL("../src/auth/issuer.ts",import.meta.url),"utf8");
 const link=readFileSync(new URL("../src/auth/link.ts",import.meta.url),"utf8");
 const recovery='if (url.pathname === "/account/erase-status" && req.method === "GET")';
 for (const change of [issuer.replace(recovery,'if (false)'),issuer.replace('action="/account/erase-status"','action="/account/erase"'),issuer.replace('href="/account/erase-status"','href="/account/erase"'),issuer.replace('name="status"','name="wrong"')]) assert.throws(()=>checkEraseRecovery(change),/GET recovery form/);
 const refusal='if (suppressed.rowCount) throw new Error("Link flow predates erasure; start linking again");';
 assert.ok(link.includes(refusal));
 for (const replacement of ["","if (false) {"+refusal+"}",refusal.replace("suppressed.rowCount","false && suppressed.rowCount")]) assert.throws(()=>checkLinkSuppression(issuer,link.replace(refusal,replacement)),/pre-erasure link flows/);
 assert.throws(()=>checkLinkSuppression(issuer.replace("startedAt: flow.initiatedAt","startedAt: Date.now()"),link),/pre-erasure link flows/);
 assert.throws(()=>checkLinkSuppression(issuer.replace("flow.context.startedAt,","flow.initiatedAt,"),link),/pre-erasure link flows/);
 assert.throws(()=>checkLinkSuppression(issuer,link.replace("pg_advisory_xact_lock(hashtextextended($1,0))","pg_advisory_xact_lock(hashtextextended($1,1))")),/pre-erasure link flows/);
 assert.throws(()=>checkEraseRecovery(issuer.replace('"referrer-policy":"same-origin"','"referrer-policy":"no-referrer"')),/same-origin Referrer-Policy/);
 const confirmationStart=issuer.indexOf('if (flow.context.stage === "erase")');
 const confirmation=issuer.slice(confirmationStart);
 assert.ok(confirmation.includes('"cache-control":"no-store"'));
 assert.throws(()=>checkEraseRecovery(issuer.slice(0,confirmationStart)+confirmation.replace(',"cache-control":"no-store"',"")),/confirmation status secret with no-store/);
 assert.doesNotThrow(()=>checkEraseRecovery(issuer));
 assert.doesNotThrow(()=>checkLinkSuppression(issuer,link));
});
