---
name: verify-scoat
description: Verify Scoat after changes to P01 HTTP/MCP transport, registry schemas, denied controls or fixture resources, P02 release validation, publication, checklist construction or generated guidance, or P03 evidence, compatibility, pricing or HuntView projection. Also verifies P04 durable hunts and account fences and P05 OAuth, HTTPS identity, linking and read grants, plus P06 durable Memory, browser-approved commands, enrollment, erasure and retention. Covers compiled local service behavior; excludes real-host acceptance, live shopping, watches and interactive Person controls.
---

## Choose the verification branch

1. Run `npm ci` and `npm run build` from the repository root on Node 24. Stop and report FAIL if either command fails.
2. For HTTP transport, registry, authorization denial, fixture app or driver changes, load [foundation](features/foundation.md). It defines the P01 lanes and their existing host/confirmation limits.
3. For release validation, publication, lookup, checklist or renderer changes, load [knowledge](features/knowledge.md). It defines P02 scenarios, immutable-pin checks and source auditing.
4. For evidence, compatibility, pricing or HuntView changes, load [hunt](features/hunt.md). For shared adapter or driver changes, run all affected branches. Read the [feature index](features/README.md) only when ownership is unclear.
5. For durable store, account incarnation, receipts or lifecycle fences, load [durable hunts](features/durable.md).
6. For OAuth, issuer configuration, identity linking, read grants or authenticated MCP changes, load [authentication](features/auth.md). For identity linking, also load [memory and erasure](features/memory.md) to verify stale callbacks across erasure.
7. For Memory, profile snapshots, exact browser approval, enrollment, OAuth ownership, erasure, migration or retention changes, load [memory and erasure](features/memory.md). Run P04 and P05 for account/authentication changes.
8. Run the branch commands, `npm run typecheck`, `npm run lint` and `npm test`. Use pstack-run for noisy finite checks. Retain its result JSON and logs under `~/tmp`.

## Completion and evidence

Record the exact committed head and clean worktree status with command receipts. PASS means every required assertion in that branch executed successfully against that head. FAIL means a command or assertion failed; include the saved error evidence. UNTESTED means a required environment or session was unavailable; name it without converting another probe into a pass. A command's zero exit alone does not discharge explicitly untested gates.

Return each requested check, its PASS/FAIL/UNTESTED state, and the evidence path. Completion requires an entry for every selected branch scenario, static check, test suite and performance gate. Do not claim full verification while a required gate is UNTESTED. The drivers close their own clients, servers and temporary publication directories. Retain evidence and leave unrelated processes and data alone.
