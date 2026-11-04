---
name: verify-scoat
description: Verify Scoat after changes to P01 HTTP/MCP transport, registry schemas, denied controls or fixture resources, P02 release validation, publication, checklist construction or generated guidance, or P03 evidence, compatibility, pricing or HuntView projection. Also verifies P04 durable hunts and account fences. Covers compiled local service behavior; excludes real-host support, shopping, OAuth, watches and interactive cards.
---

## Choose the verification branch

1. Run `npm ci` and `npm run build` from the repository root on Node 24. Stop and report FAIL if either command fails.
2. For HTTP transport, registry, authorization denial, fixture app or driver changes, load [foundation](features/foundation.md). It defines the P01 lanes and their existing host/confirmation limits.
3. For release validation, publication, lookup, checklist or renderer changes, load [knowledge](features/knowledge.md). It defines P02 scenarios, immutable-pin checks and source auditing.
4. For evidence, compatibility, pricing or HuntView changes, load [hunt](features/hunt.md). For shared adapter or driver changes, run all affected branches. Read the [feature index](features/README.md) only when ownership is unclear.
5. For durable store, account incarnation, receipts or lifecycle fences, load [durable hunts](features/durable.md).
6. Run the branch commands, `npm run typecheck`, `npm run lint` and `npm test`. Use pstack-run for noisy finite checks. Retain its result JSON and logs under `~/tmp`.

## Completion and evidence

Record the exact committed head and clean worktree status with command receipts. PASS means every required assertion in that branch executed successfully against that head. FAIL means a command or assertion failed; include the saved error evidence. UNTESTED means a required environment or session was unavailable; name it without converting another probe into a pass. A command's zero exit alone does not discharge explicitly untested gates.

Return each requested check, its PASS/FAIL/UNTESTED state, and the evidence path. Completion requires an entry for every selected branch scenario, static check, test suite and performance gate. Do not claim full verification while a required gate is UNTESTED. The drivers close their own clients, servers and temporary publication directories. Retain evidence and leave unrelated processes and data alone.


## P05 authenticated HTTPS and durable identity

Trigger: changes to `src/auth/`, authenticated MCP dispatch, issuer configuration, app read grants or HTTP identity/origin bounds. Preserve the P01–P04 commands and historical receipts.

1. Run `npm ci`, `npm run build`, `npm run typecheck`, `npm run lint`, and `npm test`.
2. Run `npm run verify -- p01`, `p02`, `p03`, and `p04` separately. P01–P03 use the historical isolated fixture; they are not production authentication proof.
3. Run `npm run verify -- p05`. Inspect `~/tmp/scoat-delivery/p05/verify-*/receipt.json`: exact clean head, PostgreSQL version, ten local lanes, redacted actual HTTP interactions, final canonical projection, linking, bounds and incarnation results. The driver stops its production HTTPS child and test issuer, drops its schema and removes private keys/certificates. Database helpers remove owned data/socket paths while retaining logs.
4. Run `npm run perf -- p05` without overlapping loads. Inspect raw samples, five batches, 100 hunts/eight clients, each-batch and combined p95 ≤750 ms, separate validation/handler timing, and zero unauthorized mutations. OAuth login/network is outside warm measurements. Preserve bad samples. Trunk's absent authenticated operation has no ratio.
5. Record external upstream/host, ten model-agent lanes, actual screenshots/video, fixed two-vCPU and independent review as UNTESTED/PENDING unless actual evidence exists. Synthetic OAuth clients are never evidence of ChatGPT/Claude/Codex host support. Production launch/configuration and linking constraints are in `docs/host-support.md`.
