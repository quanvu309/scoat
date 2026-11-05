# Linked public acceptance (P09 S4)

Run `npm run build`, then `pstack-run run --timeout 600 -- npm run verify -- p09`. It needs an absolute `SCOAT_PG_BIN` (and `SCOAT_PG_LIB` when the client libraries are not on the loader path), Playwright Chromium, and ffmpeg plus ffprobe from `SCOAT_FFMPEG`/`SCOAT_FFPROBE` or `PATH`. It uses `DATABASE_URL` when set, otherwise the shared local PostgreSQL 17.6 used by P04. Evidence goes to `SCOAT_EVIDENCE_DIR` or a fresh `~/tmp/scoat-delivery/p09/s4/story-*` directory. Run from a clean committed checkout so the receipt records a clean head.

Exit 0 is `PASS_LOCAL_ONLY`. Exit 2 is `BLOCKED`: the story ran but ffmpeg or ffprobe is missing, and the receipt names the missing tool. Any failed assertion, a video outside 30–60 seconds, a missing screenshot or a detected secret is `FAIL` with exit 1.

## The story

One run reuses the IDs each step creates. Story code is `scripts/story-lanes.mjs`; `checkAcceptanceAuthority` keeps it on public clients.

1. The server `/healthz` artifact digest equals the digest the fixture worker announces after `startWorker`.
2. The `host-one` SDK StreamableHTTP client runs the eight-row, eleven-slot Pi Hut 4GB hunt with compatibility and finish. Canonical HuntView has known GBP 70.00, conditional GBP 63.00 requiring `verify-student`, a ready URL and matching text.
3. A profile proposal and a save proposal are each approved on native `/account/memory`, then resubmitted unchanged over MCP.
4. A separately authorized `host-two` client for the same upstream subject lists and reads the hunt, profile and saved item with release, progress, ready URL and final quote unchanged.
5. A fresh hunt gets Skip from the text hub link, then Skip and Stop from the live card through native `/account/control`. A repeated Stop from the text hub returns `unchanged` and keeps the first `stopRequestedAt`.
6. The finished card shows the finished quote, conditional price, step and proof links. Its Watch button opens the same URL as the text entry. Native `/account/watch` confirms GBP 68.00 against the GBP 70.00 baseline. A seller price of 5620 plus 380 delivery and one real worker tick produce exactly one accepted local TLS mail showing GBP 60.00; a second tick adds none.
7. An RFC 8058 one-click POST to the captured `List-Unsubscribe` link cancels the watch. A next-day check enqueued through the queue contract completes with no new mail or seller requests.
8. A second watch is confirmed from the text link and work is queued. The worker is paused with SIGSTOP, the account is erased on native `/account/erase`, and the worker resumes. No new mail or seller request follows; no account job remains. A read-only scan of every application and queue table finds only the `hunt_accounts` tombstone and `account_suppression`. Both old bearers and every prior card grant get 401.

## Boundaries

`scripts/story-conditions.mjs` is the only place that sets synthetic state: seller price, verified-email claims, plan ticks, next-day checks and worker start, pause, resume and stop. Each call is logged in `transcript.jsonl` and `receipt.json`. Proof reads run in `BEGIN READ ONLY`. The auth and watch fixtures still create their schemas, OAuth test provider, keys, seller and mail capture; that is fixture setup, not story action. The card harness follows the card's open-link request in the same recorded tab.

## Evidence

The directory holds `p09-review-{memory,card,control,watch,mail,unsubscribe,erase}.png`, `p09-review.mp4` (with the `p09-review.source.webm` recording), `transcript.jsonl`, `visible.jsonl`, `projection.json` and `receipt.json`. The video is one Playwright recording of the story page, transcoded once. Its duration comes from ffprobe; the receipt states the review dwell added after each screenshot. The erase status secret is masked in the DOM before paint, and the mail recipient and one-click token are replaced before rendering.

The receipt records head, porcelain, tracked-patch digest, Node, PostgreSQL server, `pg_dump`, Chromium and ffmpeg versions, hardware, the release digest from manifest, health and worker, conditions and per-step results. The secret scan checks every text file and every captured page text and URL against the fixture bearers, cookies, keys, email, grants, unsubscribe link and erase status secret. The byte scan of images and video only rules out literal strings; masking is the control for pixels.

`npm test` runs `test/acceptance-lint.test.mjs`. It rejects the P08 `watch-lanes.mjs` shape, `seedWatch`, `dist` and dynamic imports, direct SQL writes, direct claim changes, raw fixture tool calls, unrecorded conditions, a non-read-only proof transaction, the original fixture worker with no digest, and missing routing.

## Labeled limits

Step durations come from one run on the recorded hardware and include review dwell. They are not a benchmark. Real MCP hosts, external IdP, Resend and DKIM, live seller and checkout, a model agent, managed PostgreSQL, systemd deployment, key rotation, a fixed two-CPU runner and production acceptance are UNTESTED. Trunk has no runnable hunt to compare against.
