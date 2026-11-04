## Problem

Scoat is greenfield and shares an OAuth account across hosts with different MCP capabilities. Agents own search and reasoning, while a durable referee must enforce evidence, offer status, terminal checklist coverage and separate money totals despite concurrent agent and person actions. There is no retailer or bank integration, and some hosts cannot display the card.

## Usage (caller's view)

Connect with Scoat OAuth. Read `scoat://playbooks/benefit-hunt` (or call `get_playbook` where resources/prompts are unavailable); invoke the `benefit_hunt` prompt for host-native guidance. Start or resume a hunt with `hunt`. The response includes the current checklist, facts revision, card and complete text fallback. Delegate independent rows to subagents, giving each the hunt ID and row ID. Search and inspect sources using host capabilities; Scoat does not browse for the agent. Every mutation has a stable request ID; retry the same request with the same ID. Read `hunt` again after a conflict or a card action.

```ts
// Agent: start the Nike hunt. The checklist comes from the pinned playbook.
hunt({ op: 'start', requestId: 'start-1', product: { label: 'Nike trainers', url: 'https://www.nike.com/gb/t/example' }, market: 'GB', budget: { currency: 'GBP', minor: 6000 } })
// -> { huntId: 'h1', rows: [...], factsVersion: '2026-11', card: ..., text: '...' }

// Agent/subagent: evidence is a public URL and observation time, not a promise.
hunt({ op: 'record', requestId: 'find-1', huntId: 'h1', rowId: 'student', expectedRevision: 0,
  find: { label: 'Student 10%', source: { url: 'https://www.nike.com/gb/student-discount', observedAt: '2026-11-04T10:00:00Z' },
    offer: { kind: 'discount', status: { kind: 'needs_step', step: 'Verify student status' }, amount: { kind: 'percent', basisPoints: 1000 }, code: { kind: 'none' } } } })
// -> current row and card; this unconfirmed discount is excluded from guaranteed totals.

// Iframe via the host bridge: poll, then send a person action with a stable ID.
callServerTool('hunt', { op: 'read', huntId: 'h1' })
callServerTool('card_action', { op: 'skip', requestId: 'click-1', huntId: 'h1', rowId: 'cashback' })
// The next read tells the agent who skipped it. The agent names remaining gaps and calls finish.
```

After all rows are terminal, `hunt({op:'finish', ...})` specifies confirmed payable lines and confirmed back-later lines, or records an unknown result when there is no proven price. The server validates their evidence and compatibility, calculates the total and budget comparison, and returns a ready-link action. `memory` manages profile and saved items; `watch` sets or stops a daily email watch. A ready link is obtained with `ready_link` only for an evidenced product destination; it opens a retailer checkout, and Scoat never pays.

## Shape

The authoritative data is a versioned playbook containing ordered checklist row definitions and fact references, plus versioned facts with sources; a hunt pins both revisions and materializes row instances from that playbook, including four separate seller slots. Every row owns an append-only record of evidence and a revision. `hunt` is the single referee for agent changes, result selection and calculations. Person actions enter through `card_action`, an authenticated host-bridge-only entry point, and update the same ledger. Each mutation has an account-scoped idempotency key and canonical payload digest; a transaction stores its result with the mutation. Distinct rows update independently; a same-row revision conflict returns current state and a next action. Finish checks all rows and commits against a hunt snapshot in one transaction. Stop is a durable request, not silent completion: the agent must explicitly name gaps. Per separate-before-serializing and make-operations-idempotent, independent rows do not compete for a global revision until finish.

All external input is parsed at MCP, OAuth and fetch boundaries; authenticated account and actor are never accepted from tool arguments. Tagged unions distinguish terminal rows, statuses, money and adjustments. The referee validates source/time, seller-code provenance, selected quantities and compatibility, rejecting unsupported or ambiguous arithmetic with actionable errors. Guaranteed pay-today includes only confirmed evidenced lines; back-later is separate and never used for budget. Unconfirmed options are shown separately. Per single-source-of-truth, rendered prompts, skill exports and checklists derive from the same versioned playbook; facts are immutable revisions with provenance. The MCP layer exposes five compact agent tools; it hides transactions, authorization, version pinning, arithmetic and card rendering, while exposing evidence and row decisions that only the agent can make. Storage and SDK wire types remain inside adapters. No server-side search strategy, automatic verification or payment is implied.

## Synthesis decision

Pending the parent architecture exploration; this is candidate 3 only, with no claim about other candidates.

## Tradeoffs accepted

- We accept retrying same-row conflicts in exchange for independent parallel row writes.
- We accept that unknown prices and unsupported combinations cannot produce a guaranteed total in exchange for auditable arithmetic.
- We accept narrow public-page rechecks and unknown outcomes in exchange for no private retailer or bank access.
- We accept pinned older facts on resumed hunts in exchange for reproducibility; a new hunt uses current revisions.

## Alternatives considered

A server-orchestrated workflow could hide row order, but exposes workflow controls and constrains agent fan-out; it hides strategy the host already handles. A free-form notes ledger has a smaller apparent interface but exposes proof, completion and arithmetic checks to every caller, so it cannot enforce the hard rules.

## Open questions and risks

- Which affiliate networks and domains can reliably produce tagged destination links, and should an unavailable tag return an untagged destination with explicit disclosure?
- Which public merchants can be rechecked reliably without violating their access rules, and what consent and email delivery provider should production use?
- What confidence and source policy is sufficient to establish a seller-owned code or stacking compatibility from public evidence?
- How should hosts establish a trusted person-initiated card action when their bridge cannot attest user gestures? Until then, should skip/stop be unavailable rather than accepted from the agent?

## Next implementation step

Implement the versioned playbook compiler and transactional hunt referee with behavioral tests for concurrent row updates, retries, proof and totals.
