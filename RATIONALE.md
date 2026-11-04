# Scoat: tool and module design

## Problem

Scoat is a kit that plugs into Claude and ChatGPT to find the best benefit from what a person asks: price, student discount, member perks, cashback, points and card perks. The host agent already sees, searches, opens pages and talks, so Scoat must not rebuild any of that. It adds what agents lack: a hunt method, curated shop facts, a tracker that keeps the agent going until every place is checked, a live card she can follow and control, and memory plus daily watching that survive across chats and apps. The shape is non-obvious because a hunt has several writers at once (the agent, parallel subagents in Claude Code or Codex, and the person through the card), the money rules must be enforced by tools rather than trusted to prompts, and there is no partner access, only public sources. Spec: `arch/grounding.md`.

## Usage (caller's view)

Connect the MCP server with Scoat sign-in. Use the `hunt-best-benefit` prompt, or call `scoat_guide` on hosts without prompts. Start a hunt, record each checklist slot as you check it, follow the directive in every reply, and finish when every row is resolved. Never send totals; Scoat prices the result.

```ts
// 1. Agent starts the Nike hunt. The checklist comes from the pinned release; her profile is snapshotted.
const { view } = await call("scoat_hunt", { op: "start", requestKey: "k-start",
  intent: { product: { kind: "url", url: NIKE_URL }, variant: "UK 6", shop: "nike", budget: { currency: "GBP", pence: 6000 } },
  profile: null });
// view.rows: shop-price, other-sellers (4 distinct slots), student, membership, codes, cashback, price-match, card-perks
// view.directive: { kind: "continue", rows: [...] }. The live card opens in the chat.

// 2. Agent or a subagent records one slot. Rows update independently, so parallel rows never conflict.
await call("scoat_hunt", { op: "record", requestKey: "k-student", hunt: view.hunt, row: "student", slot: 0,
  expected: studentRow.revision, outcome: { kind: "found", offers: [{ kind: "discount", seller: "nike", variant: null,
    adjustment: { kind: "percent", basisPoints: 1000, basis: "item" }, code: null,
    status: { kind: "needs-step", steps: ["verify-student"] },
    proof: { url: NIKE_STUDENT_URL, observedAt: "2026-11-04T10:00:00Z", note: "10% online only" } }] } });
// A row Scoat cannot settle: { kind: "gap", reason: "cashback site blocked" } or { kind: "none", checked, proof }.

// 3. Agent finishes. Scoat refuses if any row is open, and names them.
const done = await call("scoat_hunt", { op: "finish", requestKey: "k-finish", hunt: view.hunt, selection: null });
// done.view.best.guaranteed: known £70 (student is conditional); conditional: £63 requires verify-student;
// backLater: cashback £1.90 on its own line; budget: over by £3 on the conditional path; ready: tagged link.

// 4. The card, inside the chat, through the host bridge. The grant comes from hidden result _meta.
await app.callServerTool({ name: "scoat_card", arguments: { op: "poll", hunt, grant } });          // every 3 s
await app.callServerTool({ name: "scoat_card", arguments: { op: "act", hunt, grant, requestKey: "click-1",
  action: { kind: "skip", row: "card-perks" } } });                                                  // she taps Skip
```

`scoat_memory` reads or updates what she has, saves a finished hunt, watches it daily for a target price by email, stops a watch, or erases her data. `scoat_hunt {op:"list"}` resumes a hunt in another chat or app.

## Shape

**Tools.** Three agent tools and one card-only tool: `scoat_guide`, `scoat_hunt`, `scoat_memory`, `scoat_card`. Each is coarse: `scoat_hunt` hides checklist construction, evidence checks, row concurrency, pricing, the finish gate, the ready link and rendering. The ready link comes back inside the finished view, so no separate call exists (per interface depth). One `toolCatalog` drives listing, visibility and descriptions; one `promptCatalog` names the prompt, resources and card app.

**Data.** `domain.ts` holds the values. Offers always carry seller, variant, status and proof, and always have a value; "no price" is a row outcome (`none` or `gap`), never an offer with a zero. `PayToday` is `known` or `unknown`, `Quote` keeps `guaranteed`, `conditional` and `backLater` as separate ledgers with no shared total, and `BudgetFit` reads pay-today only. `Person` can only be minted from a verified app grant, so an agent cannot skip a row on her behalf (per encode-lessons-in-structure).

**State.** `hunt/store.ts` (internal) keeps one record per row with its own revision. Records on different rows never conflict; a same-row conflict returns the current state and a next step. Finish and stop take every row lock in one transaction. A person's skip is sticky and wins over agent writes on that row. Every mutation has an account-scoped request key with a payload digest, so retries replay and a reused key with a new payload is refused (per make-operations-idempotent).

**Knowledge.** A `Release` publishes playbooks and facts together and is validated on publish. A hunt pins one release id. `checklist()` is the only checklist constructor and `renderGuide()` the only renderer, used by the prompt, resources, guide tool and SKILL.md export (per single-source-of-truth).

**One projection.** `renderView()` produces `HuntView`, including `text` and `directive`. The card renders it, text-only hosts print `text`, and the agent reads `directive`, so the three can never disagree.

**Boundaries.** `checkEvidence()` enforces HTTPS, observed time and freshness, variant match, distinct sellers, and forces code-site codes to `untested`. `priceQuotes()` is pure and is the only place money is calculated. Scoat never searches, never pays, and never claims a bank or Visa offer.

## Synthesis decision

Base: candidate C (agent-led, server as referee). Its row-level transactions are ordinary database work a 1 to 3 person team can build and reason about, and its agent-led stance matches "if the agent can do it, the agent does it". The Codex cross-judge reached the same pick independently.

From candidate A: the three-plus-one tool surface and single `toolCatalog` (C had five tools, including a separate `ready_link`); the money types `PayToday`, `Quote` with conditional scenarios, `BudgetFit`; the `CheckOutcome` union, which merges C's separate record and mark ops into one; `renderView` with a `directive` as the single projection; and the app-only grant in hidden `_meta` for person controls.

From candidate B: evidence-boundary checks (subject and variant match, freshness, code provenance) and distinct-seller coverage, now `checkEvidence` and `RowRecipe.distinctSellers`; and publish-time release validation.

Rejected: A's causal event-set fold and B's ticket and lease workflow engine. Both are correct, and both are much more machinery than v1 needs.

## Tradeoffs accepted

- We accept retrying same-row conflicts in exchange for parallel subagents never blocking each other.
- We accept that a hunt keeps its pinned release after facts change, in exchange for results that can be reproduced; a new hunt picks up new facts.
- We accept a known pay-today only when delivery is proved, in exchange for never showing a total that is wrong at checkout.
- We accept text-only hosts having no person skip, in exchange for agents never being able to fake one; there, the agent names gaps instead.
- We accept physical deletion on erase as the one exception to keeping history.

## Alternatives considered

- **Event log with a pure fold (candidate A):** hides concurrency best, but causal cuts and finish invalidation are a large correctness project for v1.
- **Server-driven plan with tickets (candidate B):** enforces order hardest, but adds a workflow engine and takes strategy away from agents that already search well.
- **One stateless "find deals" tool:** looks smaller, but duplicates host search and pushes completion, resume and person control back onto every caller.

## Open questions and risks

- Which hosts can keep the app grant out of model context and attest a real tap? Should hosts that cannot be read-only?
- What freshness window per row is right (for example, price 1 hour, student scheme 30 days)?
- Which public pages can daily rechecks fetch within their terms, and which email provider honours idempotency keys?

## Next implementation step

Implement `checkEvidence`, `priceQuotes`, `pickBest`, `finishable` and `renderView` as pure functions with tests on the Nike example (£70 guaranteed, £63 conditional on verify, £1.90 back later, £3 over budget), then the row store and `Hunts.run`.
