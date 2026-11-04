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

`npm test` adds PostgreSQL proofs in `test/watch-corrections.test.mjs`:

- The plan waits on the erase account fence while holding no alert lock, finishes on one connection and does not retry.
- Queue deletion removes 18 scoped jobs across six states and a legacy `watch-send-dead` queue, and preserves another account's 18 jobs.
- A sender without a mail transport writes no marker, and `startWorker` refuses it.
- RFC 8058 one-click works over HTTPS in both form encodings. Duplicate, extra, wrong-value, file, malformed, oversized and text bodies return 400 and leave the watch active.
- `dist/worker.js` exits without `resendApiKey` and installs no queue schema.

The P07 card lane checks the unconfigured explanation and the MCP `service-unconfigured` result.

## Limits

The capture process models the Resend contract over local TLS. A live Resend account, live seller checkout, real hosts, model agents and fixed two-CPU runners stay UNTESTED unless run separately. Only The Pi Hut Raspberry Pi 5 exact variants in UK Royal Mail 1st Class context are supported; everything else is unknown.
