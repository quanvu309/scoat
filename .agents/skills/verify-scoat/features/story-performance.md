# Story performance (P09 perf)

Run `npm run build`, then `pstack-run run --timeout 900 -- npm run perf -- p09` from a clean committed checkout. It needs the shared PostgreSQL binaries used by P04 (or `DATABASE_URL`) and OpenSSL. It runs no browser. Evidence goes to `SCOAT_EVIDENCE_DIR` or a fresh `~/tmp/scoat-delivery/p09/perf-*` directory: `p09-perf.json` (receipt and verdict), `story-samples.json` (raw samples) and `perf.json` (supplementary lineage microbenchmark). Exit 0 is `PASS_LOCAL_ONLY`; any failed assertion or budget is `FAIL` with exit 1.

## What runs

`scripts/perf.mjs p09` imports `scripts/perf-p09.mjs`. That script probes trunk first, then calls `measureStory` and `judgeStory` from `scripts/perf-story.mjs`, then runs `scripts/perf-lineage.mjs`.

One batch runs three complete hunts and one watch notification. Batch 0 is warmup; five warm batches follow.

- Hunt: one SDK StreamableHTTP client over local HTTPS calls `scoat_hunt` start, eleven slot records, two compatibility links, finish and read. A READ ONLY query asserts the persisted `durable_hunts.snapshot` is the finished view (GBP 70.00 known, GBP 63.00 conditional) with eight rows.
- Watch: the last hunt's Watch URL is confirmed on the issuer `/account/watch` form through the scripted fixture cookie jar. The seller fixture drops to 5620 + 380 delivery. One real plan tick runs in the fixture worker, and the local TLS capture accepts one message for the alert's provider key.
- Readiness: `/healthz` must be ready with the verified digest equal to the worker's `startWorker` announcement and `dist/release.json`. The worker process must stay alive.
- Repeat: a final tick on the same day adds no delivery or provider request. Each alert key is accepted once.

## Gates

Every warm hunt must take at most 5000 ms, measured from start through read. Search is agent-supplied and synthetic, so none is included. Eligible-to-outbox must be at most 5000 ms per warm watch. It runs from `watch_observations.observed_at` to the `watch-check` job's `completed_on`, both on the database clock. The job completes after the outbox commit. The fence and lock statements before the observation insert fall outside that window, so the whole `watch-check` job (its own start to completion, including the local seller fetch) must also stay within 5000 ms. There must be no MCP protocol errors, persisted final views on every hunt, one acceptance per alert, an unchanged repeat tick, and readiness and worker health in every batch.

`p09-perf.json` reports, without gating, the watch activation time, tick-to-accepted time (local capture, not real mail arrival), health latency, the per-operation MCP time and the limiting operation.

## Enforcement

`test/perf-lint.test.mjs` runs `checkPerfStory` from `scripts/check-perf.mjs`. The check rejects:

- the original 9705fec entry that ran only the lineage microbenchmark;
- the 9705fec lineage receipt that deferred the story as pending;
- a microbenchmark that runs before or instead of the story;
- an exit code that ignores the verdict;
- `seedWatch` and other fixture internals, dist or dynamic imports;
- direct SQL writes and non-literal or non-SELECT proof reads;
- a missing health or watch route;
- budgets above 5000 ms or more than one acceptance per alert.

## Labeled limits

These are local fixture timings: one runner, one sequential MCP client, worker concurrency 4, and the embedded cluster's `initdb` superuser role. The receipt records the observed role flags and settings. Trunk 8e81688 has no server, database, worker or perf entry. The receipt records it as unavailable, with no shared operation and no ratio. Real search, seller and mail latency, production delivery, real hosts, external IdP, managed PostgreSQL and a fixed two-CPU runner are UNTESTED.
