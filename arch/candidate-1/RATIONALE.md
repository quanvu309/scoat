## Problem

Scoat adds public benefit knowledge, persistence and a live hunt card to hosts that already search, see images and reason. Greenfield v0.7 requires concurrent agents and person controls, cross-host OAuth identity, source-backed findings, complete checklists, and a strict separation of immediate payment from future rewards. This candidate makes a hunt an immutable set of actor events; every visible hunt value is a pure fold of that set and its pinned knowledge release.

## Usage (caller's view)

Connect the authenticated MCP server. Use `hunt-benefits` when the host supports prompts; otherwise call `scoat_guide`. Describe photos in words using the host's vision. Start once with a durable request key, retain the returned hunt ID, and pass that ID to other agents or another host. Each mutation returns the updated card state, text fallback and any person controls. Retrying the same key and payload returns the original receipt; reusing a key for a different payload fails. Below, `call` is the host's client helper: it invokes MCP `client.callTool`, schema-validates `structuredContent`, raises failures and unwraps `Result.value`.

```ts
// Call site 1: host agent, Nike example (all observations below are illustrative).
const guide = await call("scoat_guide", { job: "product", shop: "nike", market: "GB" });
const { view: opened } = await call("scoat_hunt", {
  op: "start", requestKey: "nike-start-1", release: guide.release,
  intent: { product: { kind: "url", url: "https://www.nike.com/gb/t/example" },
    shop: "nike", job: "product", budget: { currency: "GBP", pence: 6000 } }
}); // pinned profile: UK student, Nike member, Visa debit; eight derived rows

// Call site 2: agent/subagent records evidence and selects a quote.
const logged = await call("scoat_hunt", {
  op: "record", hunt: opened.hunt, requestKey: "nike-shop-1", basis: opened.revision,
  notes: [{ kind: "check", row: "shop-price", slot: 0, outcome: { kind: "found", offers: [
    { kind: "price", seller: "nike", amount: { currency: "GBP", pence: 7000 },
      status: { kind: "confirmed" }, proof: { url: "https://www.nike.com/gb/t/example",
        observedAt: "2026-11-04T07:00:00Z", note: "Selected size, online price" } }
  ] } }]
}); // returned offer ID is derived from event ID + note/offer position
// Other workers record four seller checks, student, member delivery, codes,
// cashback, price match and card perks, or name gaps where proof is unavailable.
// With offer IDs from those receipts:
const { view: latest } = await call("scoat_hunt", { op: "read", hunt: opened.hunt });
const { view: refreshed } = await call("scoat_hunt", { op: "record", hunt: opened.hunt, requestKey: "nike-quote-1",
  basis: latest.revision, notes: [{ kind: "quote", selection: {
    price: priceId, delivery: memberDeliveryId, benefits: [studentId, cashbackId],
    stackProof: [observedStackProof] } }] });
await call("scoat_hunt", { op: "finish", hunt: opened.hunt,
  requestKey: "nike-finish-1", basis: refreshed.revision, quote: refreshed.best?.id ?? null });
// If student verification is pending: guaranteed pay today £70; conditional £63,
// £3 over budget on that conditional path; cashback £1.90 separately, with status.
// Finish rejects incomplete rows; an unseen concurrent event requires a fresh finish.

// Call site 3: iframe, through @modelcontextprotocol/ext-apps App.
const polled = await app.callServerTool({ name: "scoat_card", arguments: {
  op: "poll", hunt, after: lastRevision, grant: appOnlyGrant } });
await app.callServerTool({ name: "scoat_card", arguments: {
  op: "act", hunt, requestKey: "person-stop-1", grant: appOnlyGrant,
  action: { kind: "stop" } } });
// Poll every three seconds while visible; controls also reach the agent on its next call.
```

`scoat_memory({op:"read"})` returns profile, saved items, watches and recent hunt IDs. Other operations amend profile facts, save a hunt/item, start or cancel a watch, or erase the account. The ready link is present in both card and text; it opens the seller with affiliate disclosure and any remaining steps, without purchasing.

## Shape

1. **Per-actor immutable streams, one pure fold.** A content-addressed revision names a causally closed event set. Each appended event carries its observed event IDs; a finish is valid only while it covers every current non-finish event. `hunt/index.ts` owns merge rules, evidence normalization, quote arithmetic and finalization; `hunt/store.ts` privately owns durable set insertion, causal cuts and idempotency. No shared mutable hunt head or last-writer-wins row exists (per separate-before-serializing-shared-state, foundational-thinking).
2. **Pinned executable knowledge.** A team-published release owns sourced facts and row recipes. Checklist rows, completion requirements, prompts, resources and downloadable skill text are rendered from it. Shop scope, profile snapshot and release are pinned by the opening event; newer facts require a new hunt, avoiding silent historical changes (per single-source-of-truth, boundary-discipline).
3. **Three coarse agent tools.** `scoat_guide`, `scoat_hunt`, `scoat_memory` hide replay, totals, revisions, consent and infrastructure. The app-only `scoat_card` adapts person controls and polling, rather than creating a second hunt writer. Callers supply evidence and intent, never computed totals or storage envelopes (per interface-depth, minimize-reader-load).

`src/domain.ts` owns values and evidence; `knowledge/` owns published methods; `hunt/` owns hunt policy and its private storage; `memory/profile.ts` owns declarations independently of `memory/index.ts`'s saves/watches; `delivery/` owns redirects and email; `mcp/` owns OAuth, schemas, SDK bindings and iframe rendering. `src/index.ts` is the sole package export, enforced by `package.json`; the implementation build must also forbid cross-owner relative imports of `hunt/store`. Boundary schemas parse `unknown` and enforce account ownership, source URLs/times, actor authority and currency. Opaque IDs, tagged offer statuses and separate payment/reward types carry the remaining invariants internally. Common paths are MCP → owner → storage; save/watch additionally reads the hunt owner's immutable snapshot. `tsconfig.json` checks all sketches; `npm install && npm run typecheck` repeats the check with pinned dependencies.

## Synthesis decision

Candidate 1 only: append-only event log. No comparison or synthesis has been performed by this runner; the orchestrator fills this section after comparing the independent candidates.

## Tradeoffs accepted

- We accept replay and causal-cut storage in exchange for lossless concurrent writes and deterministic cross-host resume; v1 replays the bounded hunt log without an authoritative mutable projection.
- We accept a final card returning to review after late evidence in exchange for never silently presenting a result based on an obsolete checklist or quote.
- We accept named gaps in text-only hosts in exchange for enforcing that only app-authorized person controls can mark rows skipped; an agent cannot assert a person skip.
- We accept conservative guaranteed totals in exchange for separating unverified student discounts and uncertain stacking from confirmed prices; the Nike £63 path stays conditional until verified.
- We accept physical erasure as the explicit exception to append-only retention in exchange for the person's right to delete their data.

## Alternatives considered

- **Mutable hunt aggregate with revision CAS:** hides persistence but exposes retries and row ownership to concurrent callers, or needs a large conflict-resolution API. It loses to event-set merge on interface depth for multi-host agents.
- **One stateless benefit-search tool:** hides search orchestration but duplicates the host's capability and exposes completion, resume and user control coordination to every caller. Its superficially smaller API omits the complexity Scoat exists to own.

## Open questions and risks

- Which verified-email service supports provider-side idempotency keys, and what email consent wording and UK retention policy should ship?
- Which affiliate networks and seller/program domains should the first release attest, and which public-page parsers can reliably identify the same variant for daily watches?
- What maximum hunt size and evidence-retention period should bound replay and retained causal cuts before implementing disposable checkpoint acceleration?
- Can each target host keep app-only grants out of model context and authenticate the iframe bridge; if not, should that host expose only read-only cards and named gaps?

## Next implementation step

Implement the event-set fold and transactional insert contract first, then exercise concurrent record/stop/finish, duplicate retries, conditional Nike pricing and account erasure against a real database before filling the MCP adapter.
