# P05 authenticated HTTPS and durable identity

Trigger: changes to `src/auth/`, authenticated MCP dispatch, issuer configuration, app read grants or HTTP identity/origin bounds. Preserve the P01–P04 commands and historical receipts.

For identity linking changes, also run [P06 memory and erasure](memory.md). Its HTTPS lanes reject callbacks started before erasure and permit freshly authenticated post-erasure linking.

1. Run `npm ci`, `npm run build`, `npm run typecheck`, `npm run lint`, and `npm test`.
2. Run `npm run verify -- p01`, `p02`, `p03`, and `p04` separately. P01–P03 use the historical isolated fixture; they are not production authentication proof.
3. Run `npm run verify -- p05`. Inspect `~/tmp/scoat-delivery/p05/verify-*/receipt.json`: exact clean head, PostgreSQL version, ten local lanes, redacted actual HTTP interactions, final canonical projection, browser linking with forged/replayed confirmation rejection, retired-account rejection of an already authenticated principal, authorization aliases, code-only discovery without DPoP advertisement, candidate hunts/other-identity linking refusals with unchanged accounts, identities, hunts and working tokens, 503 outage handling, bounds and incarnation results. The driver stops its production HTTPS child and test issuer, drops its schema and removes private keys/certificates. Database helpers remove owned data/socket paths while retaining logs.
4. Run `npm run perf -- p05` without overlapping loads. Inspect raw samples, five batches, 100 hunts/eight clients, each-batch and combined p95 ≤750 ms, separate validation/handler timing, and zero unauthorized mutations. OAuth login/network is outside warm measurements. Preserve bad samples. Trunk's absent authenticated operation has no ratio.
5. Record external upstream/host, ten model-agent lanes, actual screenshots/video, fixed two-vCPU and independent review as UNTESTED/PENDING unless actual evidence exists. Synthetic OAuth clients are never evidence of ChatGPT/Claude/Codex host support. Production launch/configuration and linking constraints are in `docs/host-support.md`.
