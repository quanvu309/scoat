# Operations and readiness (P09 S3)

Read [lineage](lineage.md) first; readiness reports its admission state. The operator contract is [docs/operations.md](../../../../docs/operations.md).

Run `npm run build`, then `pstack-run run --timeout 900 -- npm run verify -- p09-operations` and `pstack-run run --timeout 600 -- npm run perf -- p09`. Both need the shared PostgreSQL 17.6 binaries used by P04 (or `DATABASE_URL` with a role that may create roles and databases). The lane creates a non-superuser owner role and disposable databases, removes them, and writes `receipt.json` under `~/tmp/scoat-delivery/p09/s3/operations-*`. The lane rebuilds `dist` twice in place; run it from a clean checkout.

## Gates

1. O1: two builds from the same inputs print the same `sha256:` release digest; `verifyRelease` agrees and the manifest does not list itself.
2. O2: in a scratch copy of the release, an unchanged copy verifies to the same digest. Each of a changed migration, a changed card, an unlisted `dist` module (`artifact-inputs-changed`), an edited or truncated manifest (`artifact-metadata-malformed`) and an absent manifest (`artifact-metadata-absent`) makes `/healthz` 503 with that reason, the worker exit 78 without `worker_ready`, and `migrate` exit 78.
3. O3: default, `127.0.0.1` and `::1` bind exactly that address. Host `localhost:<port>` reaches health; an IP-literal Host and a foreign Origin get 403; the other address family is refused. Non-literal values exit 78 with `listen-host-not-ip-literal`. Record `UNAVAILABLE-ENV` if the host has no IPv6 loopback.
4. O4: an admitted HTTPS server returns 200 with `reasons: []`, the verified digest, schema `0004_lineage` current, admitted lineage, configured auth and `https`, with `cache-control: no-store` and no phase label. `/mcp` without a bearer is 401. `dist/worker.js` announces `{ ready: true, artifact }` with the identical digest, only after its queue schema exists.
5. O5: sealing makes health 503 (`lineage-sealed`) and `/mcp` 503; a worker exits 78 without announcing; unseal restores 200.
6. O6: a database outage (connections disallowed, backends terminated) leaves the server running; health is 503 with only `database-unavailable`, `/mcp` is 503, no credential appears in output, and health returns to 200 when connections resume.
7. O7: a template copy refuses server startup with exit 78 `identity-mismatch`, and its readiness reports `lineage-identity-mismatch`. An emulated newer schema head reports `schema-drift` and `lineage-schema-ahead`.
8. O8: `systemd-analyze verify` passes all three units. UNTESTED when the binary is absent. The units are never claimed deployed.

`perf -- p09` first runs the end-to-end story metric described in [story performance](story-performance.md), then the supplementary lineage microbenchmark. The microbenchmark writes `perf.json` with five warm batches of 200 alternating pairs. Each pair is the application `retryTransaction` and an unfenced transaction that runs the same `UPDATE`; the unfenced one is a measurement baseline only. The receipt holds raw samples, per-batch overhead, release verification samples, CPU/memory/load, tool versions, head and dirty state. Trunk is recorded unavailable and the fixed two-CPU budget UNTESTED.

`npm test` adds `test/operations-lint.test.mjs`, which checks the original unsafe shapes: phase-labelled health, ready computed from auth and lineage only, unverified admission, worker ready without a digest or before startup, migrate without the release check, a self-hashing manifest, separate hashing, raw `pg.Pool`, a hard-coded listen address, developer-home lane defaults, a hosted workflow without P07/P09 lanes or PGDG tools, unit drift and missing routing. It also adds `test/operations.test.mjs`, which covers release refusals, the pool outage listener and listen-host parsing.

## Labeled limits

The digest identifies the release directory, not its builder. Anyone who can rewrite the release can also rewrite `dist/release.json`. Installed `node_modules` bytes are covered only through `package-lock.json`. Hosted CI PASS needs a completed GitHub run. Real hosts, IdP, Resend, DKIM, managed PostgreSQL and an actual systemd deployment are UNTESTED.
