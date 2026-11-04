## Problem

Scoat supplies benefit knowledge, persistent hunt progress, memory and daily watching while the host supplies perception and browsing. It must enforce evidence, coverage and separate money timelines across hosts, subagents and live person actions. This greenfield candidate treats playbooks as typed programs: the server issues execution obligations rather than suggestions, including the Nike hunt's eight groups and four distinct alternative-seller obligations.

## Usage (caller's view)

Connect with Scoat OAuth, then call `scoat_advance` with a normalized product and request. The host interprets photos and files, searches, visits pages, and talks to the person. Scoat returns a typed instruction and a ticket: perform that instruction and submit its requested proof to the same tool. Repeat until the server returns a result. Use `scoat_playbook` when prompts are unavailable; `scoat_hunt` resumes a hunt on any host. Tickets can be handed to subagents; parallel hosts request additional independent work. Agents cannot select arbitrary next stages or write totals.

```ts
// Nike, UK student, Visa debit, Nike member; amounts are GBP minor units.
await mcp.callTool({ name: "scoat_advance", arguments: {
  requestId: "start-1", command: { kind: "start", product: {
    url: "https://www.nike.com/gb/t/example", label: "Nike trainers",
    variant: "UK 5 / black", market: "GB" }, budget: 6000,
    context: { student: true, cards: ["Visa debit"], memberships: ["Nike"] }
  }
}}); // work: huntId H, ticket T, kind quote, exact product/variant, required proof.

await mcp.callTool({ name: "scoat_advance", arguments: {
  requestId: "quote-1", command: { kind: "submit", huntId: H, ticket: T,
    proof: { kind: "quote", answer: { kind: "found", observations: [{
      kind: "priced", source: { url: "https://www.nike.com/gb/t/example",
        observedAt: "2026-11-04T07:00:00Z", excerpt: "£70, UK 5 black" },
      subject: "Nike trainers UK 5 black", status: { kind: "confirmed" },
      effect: { kind: "base", amount: 7000 }, conditions: []
    }] } }
  }
}}); // acceptance receipt plus next work, wait, stopped, or complete.
// Later student proof requires external verification: with confirmed free delivery, guaranteed pay stays £70
// until verified. Conditional pay is £63, £3 over budget; £1.90 cashback stays separate.
```

```ts
// MCP Apps iframe: no account token in iframe; calls use the host bridge.
const view = await app.callServerTool({ name: "scoat_hunt",
  arguments: { kind: "read", huntId: H, afterRevision: revision } });
// Poll every few seconds; render structuredContent, retain revision on unchanged.
await app.callServerTool({ name: "scoat_control", arguments: {
  requestId: "click-1", huntId: H, action: { kind: "skip", rowId: R }
}}); // app-only tool; next agent advance observes the decision.
// A text-only host uses scoat_control after host-attested human approval.
```

## Shape

Three decisions carry the design. (1) Immutable typed programs compile facts, profile snapshots and product inputs into a dependency graph; checklist rows, prompts, skill text and instructions derive from that same release, per single-source-of-truth. (2) Actor journals separate evidence and person intent; a transactional reducer alone owns row closure and result publication, per separate-before-serializing-shared-state. (3) Ticket-bound evidence decoding creates trusted observations and pricing chooses only proved compatible, confirmed combinations, per boundary-discipline. Types distinguish submission kinds, terminal rows, unknown observations and money timelines; runtime validation checks URLs, time, ticket ownership, status provenance and dependency closure.

Module map: `core` owns shared value types; `knowledge` owns releases and compilation; `hunt` owns execution, evidence and pricing; `memory` owns personal state and deletion; `watch` owns scheduled public checks; `delivery` owns affiliate redirects and email outbox; `mcp` owns OAuth/SDK adaptation and tool schemas; `card` owns presentation. Each folder's `index.ts` is its only entry. Package subpath exports and a build import rule must prohibit private imports when implementations grow. Dominant reads use account+hunt, hunt+row, hunt+actor+request, account+saved-item and due-watch indexes; compilation indexes facts by merchant/programme/market. A tool call traverses adapter → owner → store; card rendering adds no business-policy layer.

The small public surface hides graph scheduling, conflict handling, evidence validation, compatible pricing, revisioning and recovery. Callers see only the exact work to perform and the accepted receipt. Scoat never searches interactively, verifies student identity, pays, or uses private card systems. It cannot prove an agent actually visited a URL; it can reject incomplete or inconsistent evidence and preserve attribution.

## Synthesis decision

Candidate 2 only; base selection and cross-candidate adaptations belong to the parent arena. No synthesis has been performed here.

## Tradeoffs accepted

- We accept extra advance calls in exchange for server-enforced coverage and proof obligations.
- We accept short transactional projection updates in exchange for immediate stop/skip visibility; evidence writes remain per actor and never overwrite another actor's work.
- We accept pinned release/profile snapshots in exchange for reproducible hunts; changed facts or profile require an explicit successor hunt, leaving history intact.
- We accept public-page rechecks becoming gaps in exchange for avoiding partner integrations and invented prices.

## Alternatives considered

- A generic findings ledger hides persistence but exposes coverage, ordering and status policy to every host; it loses the depth of one interpreter enforcing the method.
- A server-run shopping crawler hides more execution but duplicates the host's browsing and perception, and expands Scoat beyond the specified role.

## Open questions and risks

- Which public-page extractors are reliable enough for daily price and delivery revalidation, and which must report unavailable?
- Which hosts can attest a human text confirmation for stop/skip, email consent and deletion, and should unsupported hosts offer only the interactive card path?
- What proof freshness windows and affiliate networks should the first UK release permit?

## Next implementation step

Implement the interpreter and transactional journal against the Nike fixture, proving rejected malformed submissions, skip/submit races, retry receipts, cross-host resume and the conditional £63 versus guaranteed-price distinction.
