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

Browser refusals cover `email_verified` false, a missing email claim, a stale public observation and a foreign Origin.

## Limits

The capture process models the Resend contract over local TLS. A live Resend account, live seller checkout, real hosts, model agents and fixed two-CPU runners stay UNTESTED unless run separately. Only The Pi Hut Raspberry Pi 5 exact variants in UK Royal Mail 1st Class context are supported; everything else is unknown.
