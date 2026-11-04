# P03 evidence, quotes and HuntView

Trigger: changes to `src/hunt/evidence.ts`, `pricing.ts`, `view.ts`, their domain types or shared MCP evidence schemas. Build first. Read `docs/implementation-notes.md` P03 for authoritative semantics.

1. Run `npm run verify -- p03` with pstack-run. Retain its JSON/log and reported evidence directory. The driver records exact head and status, ten numbered JSON transcripts and `projection.txt`.
2. Require PASS for each compiled lane: baseline absence; synthetic Nike totals/conditions/cashback/budgets; absent delivery; incompatible discounts; exact seller/variant; untested codes; order/minimum spend/rounding; hidden missing slot; JSON/text agreement; explicit 17-benefit limit. Inspect the lane JSON for the asserted result.
3. Run `npm run perf -- p03`. Require five warm batches, four sellers, 16 benefits per anchor, independent exhaustive valid-subset oracle, raw samples, runner metadata, 17-benefit assertion and local p95 at most 1000 ms. Retain `samples.json`. Timing includes validation, selection and view; setup, warmup, oracle/assertions and I/O are excluded. P02 has no working quote baseline, so no ratio is valid.
4. Run typecheck, lint and the full tests. Shared evidence schema changes also require P01 and P02 verification and performance regressions. Retain final clean committed-head receipts.

PASS applies only to executed compiled probes. Ten separate model-agent sessions, real-host sessions and fixed two-vCPU acceptance remain UNTESTED without their own evidence. Do not manufacture screenshots for a headless module run or call deterministic probes agent sessions. P04 durable commands, P05 identity and P07 interactive controls are outside this branch; existing unavailable/denied behavior must persist.
