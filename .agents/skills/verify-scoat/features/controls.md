# Browser controls

Run `npm run verify -- p07-controls` after building. This drives the compiled HTTPS server, disposable upstream, PostgreSQL and native Chromium forms. Run P04, P05 and P06 for shared account, authentication and erasure boundaries. Run typecheck, lint and all tests. Save exact-head receipts outside the repository.

Inspect `src/controls/codec.ts`, `src/auth/issuer.ts` and `src/hunt/index.ts`. Require cookie/Origin/action/nonce rejection, same-account fresh authentication, database-clock expiry, compact replay, independent repeat Stop/Skip, late writes and erasure. P04 and the focused controls driver must preserve NOWAIT/55P03 contention receipts before releasing barriers.

Run [live card](card.md) for the card unit. External hosts and full P07 acceptance remain untested. Never substitute local browser-unit evidence for those gates.

Configure `SCOAT_CONTROL_CONFIG` with a separate protected JSON file containing `version: 1`, a 1–32 character alphanumeric/underscore/hyphen `keyId`, and a fresh 64 character lowercase hexadecimal `secret`. Generate the secret independently of OAuth and lifecycle keys. Missing configuration disables links and control routes; malformed configured keys fail startup. Restart with a new key ID and secret to rotate. Rotation invalidates outstanding intents and confirmations immediately. Accepted receipt data survives rotation until account erasure; an old confirmation cannot recover it after rotation.

Authenticated hunt replies and card reads expose `structuredContent.controls` beside the immutable view: `hub`, `stop`, `skip: [{row,url}]`, and `watch: {available:false,reason}`. Text includes only the hub and Watch reason. Open these HTTPS links in the browser. Each native POST contains the exact signed confirmation, action and nonce and uses its own cookie. Confirmations last two minutes on the database clock; cookies last three minutes. Repeat POSTs recover the saved compact `{hunt,action,status}` outcome. Re-read the existing hunt/card read operation for the canonical current view.

Control login flows use the existing owned browser-flow inventory; accepted person receipts use the existing hunt receipt inventory. Account erasure removes both. Identity linking locks affected accounts exclusively and refuses moving an identity out of an account that owns hunts. Keep the focused pending-confirmation link refusal lane; do not add identity SQL to hunt storage.
