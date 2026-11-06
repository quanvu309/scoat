# Price watches (P08)

Run `npm run build`, then `pstack-run run --timeout 900 -- npm run verify -- p08` and `pstack-run run --timeout 900 -- npm run perf -- p08`. Both need the shared PostgreSQL binaries used by P04 (or `DATABASE_URL`), OpenSSL and Playwright Chromium. Evidence lands under `~/tmp/scoat-delivery/p08/`.

## Lanes

1. Trunk regression: trunk has no watch operation and its Delivery throws; record absence. Head produces one queued alert and one captured delivery for a 70 to 60 drop.
2. The baseline basis digest equals the new observation basis digest (URL, seller, variant, SKU, GBP, in stock, UK Royal Mail 1st Class rule).
3. A finished hunt with a conditional student total never supplies the baseline; the browser confirmation shows the separate public observation.
4. Blocked page, changed variant, changed delivery rule, private redirect and unavailable stock record unknown and send nothing.
5. Above target, equal target, equal prior alert, strictly lower, equal baseline and below baseline follow `amount <= target AND amount < baseline AND amount < prior reserved alert`.
6. Six concurrent identical daily checks plus repeated enqueue commit one observation and one alert.
7. Kill the worker after the capture process durably accepts and before acknowledgment; the retry reuses the same key and payload with one delivery.
8. Unsubscribe while pending, after the committed marker and during a fenced submit. Pending cancels; a marker reports may still arrive; a fenced submit finishes first.
9. Erase while enqueue, marker and fenced send are paused and after a killed sender connection. Zero watch rows and queue jobs survive; another account is preserved; a late job is refused.
10. The captured email names price, delivery basis, source time, clean shop URL, conditions and a working native unsubscribe form.

11. The hunt text's `Watch price:` link equals `controls.watch.url`. The live card's Watch price button opens that exact link. A second verified address shows the move notice, and native validation blocks Start until the consent checkbox is ticked. After the move, both active watches report `alertsCurrentRecipient`, and the earlier watch's next alert is delivered to the new address.

Browser refusals cover `email_verified` false, a missing email claim and a foreign Origin. They also cover a stale public observation, an expired or used confirmation (a native same-origin POST, with no injected Origin), an already-watched hunt and the active limit. Each is a no-store 409 page with a fresh-start action.

Native form submissions wait for the new POST response and document before reading a refusal. The lane replays a consumed confirmation immediately after activation and expires a separate confirmation while keeping its public quote fresh. `SCOAT_P08_FORM_DELAY_MS=350` (integer 0–5000) delays scripted native submissions to reproduce a slow browser without changing product clocks or freshness checks. Run P08 twice with this delay after changing navigation or cleanup. `test/watch-verifier.test.mjs` also forces a lane failure after the real worker starts and requires a nonzero exit within 45 seconds (cleanup under 15 seconds), no surviving fixture processes or database clients, and the original private-schema inventory. Pending browser navigation and a child ignoring SIGTERM have separate shutdown regressions.

`npm test` adds PostgreSQL proofs in `test/watch-corrections.test.mjs`:

- The plan waits on the erase account fence while holding no alert lock, finishes on one connection and does not retry.
- Queue deletion removes 18 scoped jobs across six states and a legacy `watch-send-dead` queue, and preserves another account's 18 jobs.
- A sender without a mail transport writes no marker, and `startWorker` refuses it.
- RFC 8058 one-click works over HTTPS in both form encodings. Duplicate, extra, wrong-value, file, malformed, oversized and text bodies return 400 and leave the watch active.
- `dist/worker.js` exits without `resendApiKey` before opening any database connection; the test uses its own TCP listener.
- Planner keyset pagination covers 1,004 accounts and all 6,008 due watches, including final-page expiry and overdue-alert cancellation.

The P07 card lane checks the unconfigured explanation and the MCP `service-unconfigured` result.

## Limits

The capture process models the Resend contract over local TLS. A live Resend account, live seller checkout, real hosts, model agents and fixed two-CPU runners stay UNTESTED unless run separately. Only The Pi Hut Raspberry Pi 5 exact variants in UK Royal Mail 1st Class context are supported; everything else is unknown.

Verify absent-mail browser/MCP refusal and preserved cancellation in watch-corrections. The native confirmation lane must reject zero, oversized and malformed targets with an actionable no-store refusal, then activate using the same unconsumed confirmation after correction.

Queue namespaces follow the database application schema. The default public schema retains `pgboss`; isolated schemas receive a deterministic private namespace. Run the two-fixture teardown regression and shared-database parallel tests after queue or fixture changes.

The quality suite installs Chromium before `npm test`. Browser regressions register HTTP cleanup before launching Chromium and prove missing executables fail without an open server. The live-worker failure test owns a separate database even when CI supplies a shared `DATABASE_URL`, so its zero-client and zero-schema proofs exclude parallel tests. `npm test` applies a 120-second default per test and a 180-second file deadline that reports resource types and fails leaked-handle processes; it never forces a successful exit.
