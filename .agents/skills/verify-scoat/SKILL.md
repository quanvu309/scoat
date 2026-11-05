---
name: verify-scoat
description: Verify Scoat after changes to P01 HTTP/MCP transport, registry schemas, denied controls or fixture resources, P02 release validation, publication, checklist construction or generated guidance, or P03 evidence, compatibility, pricing or HuntView projection. Also verifies P04 durable hunts and account fences and P05 OAuth, HTTPS identity, linking and read grants, plus P06 durable Memory, browser-approved commands, enrollment, erasure and retention. Also covers P07 browser-authorized Stop and Skip, signed confirmation codecs and atomic receipts. Also verifies the P07 live card, ext-apps adapter, bundle, grant renewal and polling lifecycle, plus P08 public price watches, verified recipients, bounded seller fetch and parsers, pg-boss queues, the fenced mail outbox, unsubscribe, cancellation and erasure. Covers compiled local service behavior; excludes real-host acceptance, live shopping, live mail providers and checkout. Also verifies the P09 S1 lineage foundation: database admission, the shared fenced transaction opener, seal and unseal fences, and refusal of restored copies. Also verifies P09 S2 sealed-source recovery: the recovery CLI, sealed dump and quarantined restore, single-use source consumption, target bind and atomic target migration.
---

## Choose the verification branch

1. Run `npm ci` and `npm run build` from the repository root on Node 24. Stop and report FAIL if either command fails.
2. For HTTP transport, registry, authorization denial, fixture app or driver changes, load [foundation](features/foundation.md). It defines the P01 lanes and their existing host/confirmation limits.
3. For release validation, publication, lookup, checklist or renderer changes, load [knowledge](features/knowledge.md). It defines P02 scenarios, immutable-pin checks and source auditing.
4. For evidence, compatibility, pricing or HuntView changes, load [hunt](features/hunt.md). For shared adapter or driver changes, run all affected branches. Read the [feature index](features/README.md) only when ownership is unclear.
5. For durable store, account incarnation, receipts or lifecycle fences, load [durable hunts](features/durable.md).
6. For OAuth, issuer configuration, identity linking, read grants or authenticated MCP changes, load [authentication](features/auth.md). For identity linking, also load [memory and erasure](features/memory.md) to verify stale callbacks across erasure.
7. For Memory, profile snapshots, exact browser approval, enrollment, OAuth ownership, erasure, migration or retention changes, load [memory and erasure](features/memory.md). Run P04 and P05 for account/authentication changes.
8. For P07 browser controls, codecs, confirmation, receipt namespace or repeated Stop/Skip changes, load [browser controls](features/controls.md). For the P07 live card, controller, React renderer, ext-apps adapter, packaging or grant response metadata, load [live card](features/card.md).
9. For P08 watches, verified email claims, seller fetch or parser, queue, worker, outbox, sender, unsubscribe, watch cancellation or watch erasure changes, load [price watches](features/watches.md). Also run P06 for erasure and P07 controls for browser confirmation changes.
10. For P09 lineage, admission, the `0004_lineage` migration, `begin`/`retryTransaction`, seal/unseal, or server/worker startup ordering changes, load [lineage](features/lineage.md). Every transaction passes this fence, so also run P04 through P08 and both P07 branches.
11. For P09 S2 recovery CLI, `src/recovery/*`, source consumption, target bind, quarantined target migration or `0004_lineage` provenance changes, load [recovery](features/recovery.md). Also run the [lineage](features/lineage.md) branch, because recovery shares its fence.
12. Run the branch commands, `npm run typecheck`, `npm run lint` and `npm test`. Use pstack-run for noisy finite checks. Retain its result JSON and logs under `~/tmp`.

## Completion and evidence

Record the exact committed head and clean worktree status with command receipts. PASS means every required assertion in that branch executed successfully against that head. FAIL means a command or assertion failed; include the saved error evidence. UNTESTED means a required environment or session was unavailable; name it without converting another probe into a pass. A command's zero exit alone does not discharge explicitly untested gates.

Return each requested check, its PASS/FAIL/UNTESTED state, and the evidence path. Completion requires an entry for every selected branch scenario, static check, test suite and performance gate. Do not claim full verification while a required gate is UNTESTED. The drivers close their own clients, servers and temporary publication directories. Retain evidence and leave unrelated processes and data alone.
