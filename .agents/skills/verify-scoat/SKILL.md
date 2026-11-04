---
name: verify-scoat
description: Verify Scoat's P01 compiled HTTP/MCP foundation and P02 immutable knowledge, schemas, denied controls and resources. Use after foundation or knowledge changes; does not verify shopping, OAuth, watches or real hosts.
---

## Launch

From the repo root on Node 24, run `npm ci` and `npm run build`. The driver launches the real compiled `dist/server.js` on an ephemeral loopback port and closes it. No database or email dependency is needed for this current HTTP surface. For an interactive local process, run `npm start`; `/healthz` on port 3000 reports `phase: P01` and `ready: true`. Stop that specific process after use.

## Doctor

Run `npm run verify -- doctor`. Expect UK/GBP P01 process readiness with shopping and auth unavailable. Failure means the build or HTTP startup must be fixed before driving.

## Drive

Run `npm run verify -- p01 --lane 2` for the registry feature in [features](features/README.md), or `npm run verify -- p01` for all declared lanes. The raw MCP Client reaches the compiled server through HTTP. Run `npm test -- test/protocol.test.ts` for the pinned compatibility probe and `npm run lint` for structural prevention checks. `npm run perf -- p01` records local raw timings; it cannot establish a speedup over the absent trunk endpoint.

## Evidence

Keep the driver's printed evidence path under `~/tmp/scoat-delivery/p01/`. Each lane includes inputs and observed results in `transcript.json`; `summary.json` records source identity and gates. Use only synthetic input. Lanes 6/7 are UNTESTED and lane 8 PARTIAL until real host/browser sessions exist. No screenshots, host pass or successful shopping result can be inferred from this fixture.

## Cleanup

The driver closes clients and terminates only its own child server, including the restart lane. Evidence survives automatically. Confirm the printed summary and lane transcript still exist after return. Do not remove evidence or kill other servers. The fixture HTTP feature creates no database, Compose project or persistent account.

## Helpers

`node scripts/verify.mjs p01 --lane 2` is the direct equivalent of the npm drive command. Later phase owners must extend the map only after their public interfaces work.

## P02 extension

Read [knowledge feature map](features/knowledge.md) for immutable releases, compiled guidance and the ten P02 driver scenarios. Run `npm run verify -- p02` and `npm run perf -- p02` after knowledge changes. These are deterministic service/module probes, not real-host or model-agent verification.
