# Identity and host support

Production uses oidc-provider 9.13.3 as the single Scoat HTTPS issuer, with openid-client 6.8.9 verifying the upstream OIDC login. Statically registered public code clients share a stable Scoat subject when they authenticate the same upstream issuer/subject. Email and display name never identify or link accounts. Native provider dynamic registration is disabled. Optional constrained RFC 7591 registration returns the existing configured public ChatGPT client without creating a client artifact. Redirects are pre-registered exact HTTPS URLs; PKCE S256, resource and state are required.

For automatic ChatGPT setup, set optional `registrationClientId` in the private issuer configuration to the existing ChatGPT client ID. That client must have exactly one redirect: `https://chatgpt.com/connector_platform_oauth_redirect`. Duplicate client IDs, another client sharing that callback, an unknown selector or any different selected callback fail startup. Existing configurations omit the selector and keep registration disabled; the static Codex client remains configured independently.

When selected, discovery advertises `/reg`. A successful JSON POST returns HTTP 201 with `Cache-Control: no-store`, the same static client ID, code-only grants and `none` token authentication. Repeated requests represent instances of one application, as permitted by RFC 7591 section 3.2.1. Registration adds no database rows, secrets or management credentials. Requests require the exact singleton callback and reject unsupported security metadata; bounded display metadata and scalar or short string-list extensions are ignored without fetching URLs. Bodies are limited to 8192 bytes. Client authentication defaults explicitly to `none` for this public-client policy. PKCE S256, explicit resource, state, email login and Scoat consent remain required by authorization.

Users paste `https://mcp.scoat.net/mcp`, choose OAuth, then sign in and approve Scoat access. The connection guide retains an advanced existing-client fallback. Local fixture tests establish the protocol; ChatGPT acceptance of the shared client ID and the actual production flow require a real host session and remain UNTESTED. Claude setup remains pending.

`npm run verify -- p05` runs ten local HTTPS/PostgreSQL fixture lanes. It launches the compiled production server in a child process, drives a separate test-owned upstream issuer, exchanges real authorization codes, and tests durable replay after an actual process restart. Local clients named host-one and host-two are synthetic OAuth clients. They are not ChatGPT, Claude or Codex hosts. The test upstream uses an in-memory adapter; the production issuer always uses PostgreSQL and configured persistent keys. No production fixture identity switch exists.

| Surface | Evidence | State |
| --- | --- | --- |
| Discovery, constrained ChatGPT registration, consent, code exchange, S256, exact redirect, state, resource, expiry and revocation | `npm run verify -- p05` | Local integration |
| Authenticated guide/start/list/read/record/finish, prompts and historical pinned resources | `test/mcp.test.ts`; local lane transcript and projection | Local integration |
| Two OAuth clients, same subject; different same-email subject isolation | Local lanes 2/3 | Local integration |
| Double reauthenticated explicit linking, old account tokens revoked | Local linking receipt | Local integration; existing-hunt migration intentionally refused |
| Bound read grant expiry, renewal, revocation, account/hunt/session and tombstone denial | Local lanes 6/7 and incarnation receipt | Local integration |
| Fresh same-account browser Stop/Skip and atomic replay | `npm run verify -- p07-controls` | Local HTTPS/PostgreSQL integration |
| Live React card, bridge, polling, grant rotation and native controls | `npm run verify -- p07-card`; local browser screenshots/video | Local Chromium integration; real hosts UNTESTED |
| External upstream provider and remote production deployment | Requires provisioned issuer/client credentials, TLS/DNS and provider redirect registration | UNTESTED |
| Ten model-agent/real-host lanes, screenshots and 30–60 second video | No actual host session or interaction capture available | UNTESTED |
| Fixed two-vCPU performance and comparable trunk authenticated baseline | Trunk lacks the runnable feature; runner differs | UNTESTED / unavailable |
| Pi Hut Raspberry Pi 5 exact variant, quantity one, UK Royal Mail 1st Class watches (`pihut-rpi5-v1`) | `npm run verify -- p08` against recorded pages and a local TLS mail capture | Local integration; live seller and Resend/DKIM UNTESTED |
| John Lewis watches | No enabled parser | Unsupported |
| Nike watches | No parser | Unsupported |
| Database lineage admission, seal and logical-restore refusal | `npm run verify -- p09-lineage` | Local PostgreSQL 17.6 integration; managed PostgreSQL UNTESTED |
| Sealed-source recovery, single-use consumption and crash retry | `npm run verify -- p09-recovery` | Local PostgreSQL 17.6 with PostgreSQL 18 client tools |
| Release digest, `/healthz` readiness, worker ready digest, outage 503, `SCOAT_LISTEN_HOST` IPv4/IPv6 | `npm run verify -- p09-operations` | Local integration |
| systemd units | `systemd-analyze verify` (O8) | Verified syntax only; deployment UNTESTED |
| Scripted eight-row public MCP hunt to persisted final view and queued watch notification (5 s budgets), then lineage overhead per transaction | `npm run perf -- p09` | Local fixture measurement; real search, mail arrival and fixed two-CPU budget UNTESTED |
| Hosted CI on `ubuntu-latest` | `.github/workflows/ci.yaml` | PASS only with a completed GitHub run for the exact head |

Production boot: follow [operations](operations.md). In short: run `npm ci`, `npm run build`, then `DATABASE_URL=… npm run db:migrate`, which refuses with exit 78 unless the release digest verifies. Supply `DATABASE_URL`, `SCOAT_AUTH_CONFIG` and `SCOAT_CONTROL_CONFIG` (private JSON files), `SCOAT_TLS_KEY`, `SCOAT_TLS_CERT` and `PORT` to `npm start`. The issuer config has `issuer` (HTTPS origin), `upstreamIssuer`, `upstreamClientId`, `upstreamClientSecret`, `lifecycleKey` (persisted random secret, 64–256 characters), `lifecycleKeyVersion` (persisted version identifier), `cookieKeys` (persisted random secrets, at least 32 characters), `jwks` (persisted private signing keys), and `clients` (each has `client_id` and exact `redirect_uris`). The control config is `{version:1,keyId,secret}` with a 1–32 character alphanumeric/underscore/hyphen key ID and 64 lowercase hexadecimal secret characters. Replacing its key invalidates prior control links and confirmations. Provision the upstream callback as `<issuer>/upstream/callback`. Credentials belong in private files, never in chat or committed config. The service creates its auth tables against the migrated durable schema. It refuses MCP traffic without issuer/upstream/database configuration, and refuses authenticated service traffic over plaintext HTTP. Terminate TLS in the process; forwarded headers do not establish trust. Bind/expose the loopback listener through an appropriate local network arrangement only after real deployment verification.

Only the configured production origin and exact local socket Origins/Hosts are accepted; absent Origin remains valid for native clients. Foreign or empty Origins are refused. MCP JSON bodies are bounded to 64 KiB, custom authentication forms to 8 KiB, and issuer form parsing uses the maintained integration's parser limits. Hunt lists use a server-enforced maximum of 20 and SQL cursor pagination. Four canonical product tool names remain; Memory advertises strict profile/save/read/item variants; profile and save require a separate fresh browser approval. The production HTML resource is the bundled P07 React card. It reads canonical HuntView snapshots through app-only read capabilities and opens browser confirmation links for Stop and Skip. Text includes the same control hub link for hosts without app support. Watch uses the same browser link in the card and text, and is offered only with configured mail and an eligible public-price result.

A bearer token is verified against persisted active token/session/grant records, exact resource, scope, expiry and active account incarnation before dispatch. Read-only tokens cannot write hunts. Read capabilities store only a secret digest and bind account, incarnation, hunt, OAuth session, read permission and five-minute expiry. Renewal atomically revokes the predecessor and inserts its replacement. They confer no Person authority. Open `/account/link` in a browser and freshly sign in with the existing identity. Confirm the link using the single-use same-origin form, then freshly sign in with the candidate identity. No bearer header is required for browser navigation. Browser state, nonce, PKCE and a Secure HttpOnly SameSite browser cookie bind the flow. Candidate accounts with existing hunts or other identities require a separate migration. A moved identity’s empty old account is retired under its exclusive account fence, so previously authenticated requests cannot write orphan hunts.

`npm run perf -- p05` records five warm batches, 100 hunts, eight concurrent clients and raw authenticated read/record samples. Server-Timing separates local credential validation from handler time; OAuth network/login is recorded separately and excluded from warm calls. A 750 ms p95 ceiling applies to each batch and the combined sample. No unlike-operation speedup ratio is reported. Full receipts are under `~/tmp/scoat-delivery/p05/`; exact head and dirty status are recorded in each receipt. These results do not discharge the real host, browser media or independent operator review gates.

The following P01 notes and receipts describe the isolated historical fixture. `scripts/driver.mjs` launches `test/fixtures/legacy-server.mjs` for P01–P03 regression checks. Production `src/server.ts` never imports it.

# Historical P01 compatibility and trust

Supported here means observed in the raw SDK fixture, never a claim about a product host.

| Surface | Version | Result | Evidence command |
| --- | --- | --- | --- |
| Node runtime | 24.21.0 | Supported locally | npm run verify -- p01 |
| MCP SDK Client / HTTP server | 1.32.2 | Supported fixture initialization, tools/list, tools/call, resources/read, reconnect | npm test; npm run verify -- p01 |
| MCP Apps server helpers | 1.7.5 | Supported fixture registration, visibility metadata, resource MIME/CSP | npm run verify -- p01 --lane 5 |
| MCP Apps 2.x with SDK 1.x | 2.0.4 / 1.32.2 | Unsupported dependency pairing: helpers target @modelcontextprotocol/server v2 | package peer declarations; lint fixture |
| Claude app-capable host | unavailable | UNTESTED; blocks lane 6 | Requires actual host session/version and bridge |
| ChatGPT app-capable host | unavailable | UNTESTED | Requires actual host session/version and bridge |
| Real text-only host | unavailable | UNTESTED; blocks lane 7 | Raw Client does not substitute |
| OAuth host interoperability | unavailable | UNTESTED | P05 owns authentication |
| Browser confirmation | unavailable | UNTESTED in production; lane 8 PARTIAL | Isolated session-binding fixture only |

The historical probe at `~/tmp/scoat-plan/probe-mcp.mjs` demonstrated that raw Clients can list app-only tools, reach their handlers and see result metadata. It is historical evidence, not a portable test runner. The new protocol test reproduces the visibility exposure against the pinned package and proves direct controls are denied. No grants are issued in P01.

`_meta.ui.visibility` is presentation metadata. Neither it, client-provided identity, arbitrary grants nor tool calls attest to a human gesture. In the historical P01 fixture, `person()` always throws and every card operation is denied. No account principal is created there. All other shopping operations return explicit unavailable errors and complete text; no prompt or knowledge resource promises an implemented guide.

P07 implements separately browser-authenticated same-account confirmation with an expiring, single-use nonce, browser-cookie binding, Origin checks and an explicit POST. Authority is constructed only after exact-action verification; acceptance and its receipt commit together under account and hunt fences. GET never applies a control. The isolated P01 fixture tests GET rejection and nonce/session binding; it does not implement OAuth or prove these production requirements. It is never imported by production source. No production switch enables the fixture.

The historical P01 static HTML fixture tests resource delivery and restrictive CSP only. It has no bridge, controls, external connections or shopping state. P07 proves rendering and browser controls in a local Chromium bridge fixture; real-host interoperability remains UNTESTED. Readiness reports process/transport readiness; P01 has no runtime dependency on database or email. Remote HTTP is loopback-only and unauthenticated for local fixtures; external deployment is unsupported until P05.
