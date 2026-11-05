# Operations

This page covers running one Scoat release on a single node: server, worker, migrate and recovery. Nothing here has been deployed to a real host. Each claim names the local lane that proves it. Anything without a lane is marked UNTESTED.

## Release directory and artifact digest

One release directory (for example `/opt/scoat/release`) holds the whole release. `npm ci && npm run build` writes `dist/release.json`. It lists a SHA-256 for every file in the release inputs, plus a combined `sha256:` digest:

| Input | Why |
| --- | --- |
| `dist/**` except `dist/release.json` | Compiled server, worker, recovery CLI and bundled card |
| `db/migrations/**` | Migrations that `migrate` and recovery `admit` apply |
| `knowledge/releases/**` | Default published shop facts |
| `scripts/database.mjs` | The migrate entry point |
| `package.json`, `package-lock.json` | Declared runtime dependencies |

`src/release.ts` owns this list, the hashing and the verification. The build, the server, the worker and migrate all use it.

At startup the server, the worker and `migrate` recompute the digest. Each refuses when the release is not the one that was built:

| Reason | Meaning |
| --- | --- |
| `artifact-metadata-absent` | `dist/release.json` is missing |
| `artifact-metadata-malformed` | Invalid JSON, unknown fields, or a digest that does not match its own input list |
| `artifact-inputs-changed` | A listed file changed, a file was added or removed, a non-regular file appeared, or an input directory is missing |

When the release is refused:
- The worker and `migrate` exit 78.
- The server stays up so that `/healthz` can report the reason. It skips admission, schema installation and maintenance, and answers every other request with 503.

Trust boundary: the digest identifies which release directory is running and detects drift. It is not a signature. Anyone who can rewrite the release can also rewrite `dist/release.json`. It covers installed `node_modules` only through `package-lock.json`. The Node.js binary, the environment file, configuration JSON and TLS keys are outside it.

Evidence:
- O1 builds twice and gets one digest.
- O2 changes a real migration and the bundled card, adds an unlisted module, edits, truncates and removes the manifest, and checks the refusals.
- Lane: `npm run verify -- p09-operations`.

## Readiness

`GET /healthz` is `no-store` JSON. It returns 200 only when `reasons` is empty:

```json
{"ready":true,"reasons":[],"artifact":{"status":"verified","digest":"sha256:…"},"database":"available","schema":{"expected":"0004_lineage","current":"0004_lineage","status":"current"},"lineage":"admitted","auth":"configured","transport":"https"}
```

Otherwise it returns 503, with bounded, non-secret reasons:

| Reason | Cause |
| --- | --- |
| `artifact-*` | Release refused (above) |
| `database-unavailable` | Cannot connect or read lineage |
| `database-unconfigured` | No `DATABASE_URL` or auth configuration |
| `schema-absent` | No installed migration journal (`drizzle.__drizzle_migrations`) |
| `schema-behind` | The installed journal is a strict prefix of this release's migrations |
| `schema-ahead` | The installed journal has a migration newer than this release; `current` is `unknown-<millis>` |
| `schema-drift` | The installed journal disagrees with this release's migration hashes |
| `lineage-sealed`, `lineage-consumed` | Sealed for recovery |
| `lineage-identity-mismatch` | Identity-changing copy or logical restore |
| `lineage-absent`, `lineage-populated-without-lineage`, `lineage-schema-ahead` | Not admitted |
| `auth-unconfigured` | No issuer configuration |
| `transport-unencrypted` | The node is not terminating TLS |

Migrate admission. After the release verifies, `migrate` takes the exclusive lineage lock and opens one transaction. If the lineage table exists, it must be admitted before any DDL. Otherwise only a pristine install proceeds: the pending migrations run, and genesis must admit the result before commit. A sealed, consumed, copied or restored database, a populated database without lineage, and an installed journal ahead of or different from this release all exit 78 with `{"event":"migration_refused","reason":…}` and no change. A restored copy is migrated only by recovery `admit`.

Requests that start before a seal and wait on the lineage lock get 503 `{"error":"service_unavailable","lineage":"sealed"}` on custom issuer routes and MCP authentication (O10). The same mapping covers MCP tool and transport failures; those paths have no lane. Endpoints served inside the OAuth provider keep its own error page; that path has no lane.

Startup and outage behaviour:
- **Sealed or copied database at startup.** The server exits 78. At runtime, every request gets 503 while the database is sealed.
- **Database outage.** The server keeps running and answers 503. Missing or invalid credentials still get 401. Infrastructure failures get 503.
- **Worker readiness.** The worker prints `{"event":"worker_ready","artifact":"sha256:…"}` (and sends the same value over IPC) only after admission, queue open, handler registration and the initial plan. The server and the worker report the identical digest (O4).

Evidence:
- O4: admitted.
- O5: sealed and unsealed.
- O6: outage and recovery, with no credential in the output.
- O7: copied database, a real newer migration and an emulated lineage head.
- O9: migrate refuses sealed, consumed and copied databases before DDL.
- O10: a seal that commits while a request waits returns 503.

## Listening address and TLS

`SCOAT_LISTEN_HOST` must be an exact IPv4 or IPv6 literal. The default is `127.0.0.1`. Host names, ports, brackets and zone IDs exit 78 with `listen-host-not-ip-literal`.

The bind address never widens trust. Only these are accepted:
- `localhost:<socket port>` and `127.0.0.1:<socket port>` as Host;
- the matching `http://` Origins;
- the configured issuer.

O3 binds `127.0.0.1` and `::1`. An IP-literal Host or a foreign Origin gets 403. The other address family is refused.

TLS must terminate at the node: set `SCOAT_TLS_KEY` and `SCOAT_TLS_CERT`. The server requires an encrypted socket for every authenticated request. A reverse proxy alone cannot satisfy this, because the socket check sees the proxy's plain connection. Health reports `transport-unencrypted` in that case.

## systemd

`deploy/systemd/` contains three units:
- **`scoat-migrate.service`:** oneshot, ordered before the other two.
- **`scoat-server.service`:** requires migrate. It has `CAP_NET_BIND_SERVICE` for port 443.
- **`scoat-worker.service`:** requires migrate.

All three share `WorkingDirectory=/opt/scoat/release` and `EnvironmentFile=/etc/scoat/scoat.env`. The server and worker use `RestartPreventExitStatus=78`: a typed refusal (artifact, lineage or listen host) needs an operator, not a restart loop. If migrate fails, systemd does not start the server or worker.

`deploy/scoat.env.example` lists every required name with placeholder values only. Configuration JSON goes in private `0600` files:
- `SCOAT_AUTH_CONFIG`;
- `SCOAT_CONTROL_CONFIG`;
- `SCOAT_WATCH_CONFIG`.

O8 runs `systemd-analyze verify` on the units. They have not been installed or started on any host (UNTESTED).

## Railway

`Dockerfile` and `deploy/railway/services.json` describe one image for two Railway services, server and worker, plus the Railway PostgreSQL 18.6 service. Railway has not built or run this image yet (UNTESTED). No container runtime was available where it was written, so the container build and startup are UNTESTED too.

**Ingress topology.** Railway's public HTTP domain terminates TLS at its edge and forwards plain HTTP to the container `PORT`, with `X-Forwarded-Proto: https`. Its TCP proxy would pass TLS through to Node, but it serves only a random port on a proxy domain, behind DNS-only Cloudflare records. An OAuth issuer such as `https://host:15140/` is not a usable public MCP endpoint, so the image uses the HTTP domain instead:

1. Railway edge (public TLS) sends plain HTTP to `dist/railway.js` on `PORT`, bound to `SCOAT_EDGE_LISTEN_HOST` (`::`).
2. The supervisor opens a new TLS 1.3 connection to the real `dist/server.js` HTTPS listener on `127.0.0.1` and an ephemeral port. It trusts only `SCOAT_TLS_CERT_PEM` and verifies the issuer host name against it.
3. `dist/server.js` keeps every gate: it reads its own TLS socket, matches Host and Origin exactly, and computes readiness itself.

The supervisor never trusts a forwarded header. It drops `Forwarded`, `X-Forwarded-*` and `X-Real-IP` before the HTTPS hop. It refuses any non-health request without `X-Forwarded-Proto: https` (400) and any request without a Host. Node rejects an HTTP/1.1 request with no Host as 400, and the edge refuses any other with 403. It forwards Host unchanged, so the issuer host is still the only public Host that passes. Railway healthchecks use Host `healthcheck.railway.app`. Only `GET /healthz` is rewritten to the inner loopback Host, and its Origin is dropped. The body and status still come from the readiness owner. Health is `transport: https` because the inner hop really is TLS. That says nothing about the edge. Edge TLS belongs to Railway, and anything on the project private network can reach `PORT` directly with a forged `X-Forwarded-Proto`.

**Secrets.** Railway variables carry the JSON and PEM material: `SCOAT_AUTH_CONFIG_JSON`, `SCOAT_CONTROL_CONFIG_JSON`, `SCOAT_WATCH_CONFIG_JSON`, `SCOAT_TLS_KEY_PEM` and `SCOAT_TLS_CERT_PEM`. Seal them. The supervisor validates them:
- the auth config passes the strict auth schema;
- the watch config passes its schema, names a Resend key and shares the issuer origin;
- the certificate is unexpired, covers the issuer host and pairs with the key;
- `DATABASE_URL` is PostgreSQL;
- `SCOAT_SOURCE_REVISION` is 40 hex characters;
- no host is an `.invalid`, `.example`, `.test` or `example.*` placeholder.

It then writes the secrets into a fresh `0700` temporary directory as `0600` files. It starts the child with only `PATH`, `NODE_EXTRA_CA_CERTS`, `SCOAT_KNOWLEDGE_DIRECTORY`, `SCOAT_PG_BIN`, `DATABASE_URL` and the file paths. It deletes the directory once the child is ready and again on exit. A missing or invalid name exits 78 with `runtime_configuration_refused`, which lists the names but never the values. The inner certificate is an operator-generated origin certificate for the issuer host (for example a P-256 self-signed certificate with that `subjectAltName`). It is never baked into the image or generated at boot.

**Order and outcomes.**
- Both services run `node scripts/database.mjs migrate` as the Railway pre-deploy command, so the shared `migrateAdmitted` journal runs under the exclusive lineage lock before either starts. A typed refusal (exit 78) fails the deploy without retry.
- `/healthz` gates activation. Server health is the readiness owner's report. Worker health is 503 until `dist/worker.js` announces `{ ready, artifact }` after `startWorker`, then 200 with that digest and the revision.
- Server or worker exit codes pass through unchanged, including 78. Railway cannot express `RestartPreventExitStatus`, so `ON_FAILURE` with three retries repeats a typed refusal at most three times. Each repeat refuses before any work.
- `tini` is PID 1. SIGTERM goes to the child, and the child is killed after 25 seconds. `drainingSeconds` is 30.
- Child output is limited to 100 lines per second and 4,096 characters per line. A `log_suppressed` count replaces the excess.

**Artifact.** Both stages use `node:24.21.0-bookworm-slim` pinned by digest. The build stage runs `npm ci` and `scripts/build.mjs`. The runtime stage installs the lockfile's production dependencies, the PGDG `postgresql-client-18`/`libpq5` 18.6 (key checked by SHA-256) and `tini`. It copies the built release and runs `verifyRelease` before it runs as `node`. The image refuses to build unless Railway supplies the 40-hex `RAILWAY_GIT_COMMIT_SHA`. That commit becomes the `org.opencontainers.image.revision` label and `SCOAT_SOURCE_REVISION`, and the supervisor logs it in `runtime_start` and `runtime_ready`. Recovery uses the image's `SCOAT_PG_BIN=/usr/lib/postgresql/18/bin` through `railway ssh`.

**Rollback.** Redeploy the retained previous Railway deployment, or the image for the previous commit, only if its release expects the installed migration head. Its pre-deploy migrate then applies nothing, and `/healthz` must report its digest before it takes traffic. If the database is ahead, use a forward fix as above. Never restore an older database to roll back code. Cold physical copies, snapshot rollback, PITR and total live-database-loss recovery remain unsupported.

Railway Config as Code is deprecated, and new services cannot opt into it, so `services.json` is a checked manifest of settings applied in the Railway dashboard, CLI or Infrastructure as Code. It is not read by Railway. O12 runs the supervisor locally against real PostgreSQL and the fixture IdP, sending Railway's Host and `X-Forwarded-Proto` directly. Real Railway ingress, sealed variables, pre-deploy, healthchecks, restarts and a real IdP are UNTESTED.

## Recovery

Follow [recovery](recovery.md) exactly. Commands come from the release directory: `npm run recovery -- status | seal | unseal --seal <id> | restore --archive <path> | admit`.

The environment is:
- `DATABASE_URL` for `status`, `seal` and `unseal`;
- `SCOAT_SOURCE_DATABASE_URL` and `SCOAT_TARGET_DATABASE_URL` for `restore` and `admit`;
- `SCOAT_PG_BIN`, plus optional `SCOAT_PG_LIB`, pointing at client tools whose major version is at least the server's.

Exit codes are 0, 64 (usage), 78 (typed refusal) and 70 (unexpected).

The supported path is: surviving genuine live, then seal, then a full dump, then restore into a fresh target, then `admit` of that one target.

- **Crash retry.** Rerun `admit`:
  - before consumption, it rolls back;
  - after consumption, it resumes the same target;
  - after bind, it returns `already-admitted`.
- **Irreversible.** Once the source is consumed, `unseal` always refuses, even when the target looks unadmitted or is unreachable. Losing that target strands the source.

Forbidden, and not reliably detectable:
- recovery after total loss of live;
- a snapshot or volume rollback;
- restoring only some tables;
- `pg_restore` over live;
- restoring without the post-backup erasure and mail history.

A cold physical clone, storage snapshot or pg_basebackup copy can preserve all checked identity fields. Starting one in parallel with live is forbidden: both can be admitted. Detection is limited to the tested logical restore and identity-changing copy paths.

Never treat schema-head equality as admission.

## Release rollback

Stop the server and worker before switching the release directory. Retain the current release and its manifest until the replacement is healthy.

If the previous release expects the same installed migration head, point `/opt/scoat/release` back to that retained release, verify its manifest, and start the migration unit followed by the server and worker. Confirm `/healthz` is ready and both processes report that release digest before restoring traffic.

If the database has newer migrations than the previous release understands, keep the services stopped. Use a forward fix compatible with that database. Restoring an older database to roll back code can resurrect erased accounts and repeat mail; it is forbidden. Use the sealed-source recovery procedure only for a database handoff with the genuine surviving source.

This is an operator procedure; an actual systemd rollback remains UNTESTED.

## Key rotation

None of these rotations has an executed lane. All are UNTESTED.

| Key | Location | Procedure |
| --- | --- | --- |
| Session cookie keys | `cookieKeys` in auth config | Prepend a new key and keep the old ones for verification. Restart the server |
| Lifecycle key | `lifecycleKey` with `lifecycleKeyVersion` | Suppression rows record the key version. Keep a key for at least the 31-day suppression window after its last erasure |
| Unsubscribe keys | `unsubscribe.version` and `unsubscribe.keys` in watch config | Add a new version, switch `version`, keep the old key until old mail links expire. Restart server and worker |
| Control link secret | `SCOAT_CONTROL_CONFIG` | Replacing it invalidates outstanding short-lived Stop/Skip links. Restart the server |
| Resend API key | `resendApiKey` in watch config | Replace it and restart the worker. The alert idempotency key does not depend on the API key |
| TLS certificate | `SCOAT_TLS_KEY`, `SCOAT_TLS_CERT` | Replace the files and restart the server |

## Worker outages and parser failure

Queued checks and sends are durable pg-boss jobs in the admitted database. After the worker stops, starts or crashes:
- the next run resumes them;
- sends retry with the same provider idempotency key;
- an ambiguous send past its retry horizon becomes `unconfirmed` with `retry-horizon` and is never re-sent (P08, R3).

A worker that exits 78 stays down until an operator resolves the artifact or lineage refusal.

The only enabled parser is `pihut-rpi5-v1`. A seller page that is blocked, changed or unparseable produces no comparable observation and no alert.

## Retention and erasure

Erasure deletes the account's watches, alerts, recipients and queued jobs inside the account fence. The retention windows are:
- **Erased-subject suppression:** 31 days.
- **Erase-status completion record:** 24 hours.
- **Database backups:** must not exceed 30 days. This is an operational policy that no lane enforces (UNTESTED).

Restoring a backup older than an erasure is refused unless it is a sealed handoff from the surviving live database (R2). See [Memory and erasure](memory-erasure.md).

## Supported sellers

| Seller | State |
| --- | --- |
| The Pi Hut, Raspberry Pi 5 exact variant, quantity one, UK Royal Mail 1st Class (`pihut-rpi5-v1`) | Enabled. The parser is tested against recorded pages only |
| John Lewis | No enabled parser |
| Nike | Unsupported |

Live seller checks, live checkout, commercial hosts, a real IdP, Resend delivery, DKIM, managed PostgreSQL permissions and failover, and the fixed two-CPU budget are all UNTESTED.

## Evidence

- `npm run verify -- p09-operations`: O1–O8 receipt under `~/tmp/scoat-delivery/p09/s3/operations-*/receipt.json`.
- `npm run verify -- p09-lineage` and `npm run verify -- p09-recovery`: lineage and recovery gates.
- `npm run perf -- p09`: the scripted eight-row public MCP hunt to a persisted final HuntView and a queued watch notification, with readiness and worker digest, written to `p09-perf.json`; then per-transaction lineage overhead and release verification samples, written to `perf.json`. Local fixture timings only.
