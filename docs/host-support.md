# Identity and host support

Scoat uses local email-code sign-in at `https://mcp.scoat.net/login`. Resend delivers six-digit codes; codes expire after ten minutes and accept five attempts. Explicit enrollment creates an account. A thirty-day browser session lets subsequent ChatGPT or Claude connections proceed to Allow/Deny consent. Sensitive actions always require a fresh code. OAuth retains PKCE, rotating refresh tokens and account/lineage fences.

Production authentication configuration is the JSON file named by `SCOAT_AUTH_CONFIG`, or Railway's sealed `SCOAT_AUTH_CONFIG_JSON`. Add `loginMailKey` (a Resend API key from the existing Resend account's API Keys page) and `loginMailFrom` (an address on the existing verified `ai.scoat.net` sender domain). Remove `upstreamIssuer`, `upstreamClientId`, and `upstreamClientSecret`; Clerk and upstream OIDC are no longer used. No new standalone environment variables are required. Keep the existing issuer, signing keys, lifecycle key and client policy. Watch delivery keeps its own configuration and quota; authentication reserves at most 80 sends per database day, three per address per hour and ten per peer IP per hour.


Optional `registrationClientId` selects the stable ChatGPT client with the exact callback `https://chatgpt.com/connector_platform_oauth_redirect`. `registrationKeys` is a dedicated versioned list of `{version, secret}` values; the first signs new immutable issuer-bound client IDs. Retain prior keys for active connections and v1 compatibility. Connection-specific ChatGPT callbacks use `https://chatgpt.com/connector/oauth/<id>`; Claude supports its configured hosted callbacks and native loopback callbacks, with port matching relaxed only for native clients. Registration creates no Client artifacts. Static clients remain available independently.

Discovery advertises authorization-code and rotating refresh-token grants, with `openid` and `offline_access` scopes. PKCE S256, an explicit resource, state and Allow/Deny consent remain required. Grant, Session and refresh-token lifetimes are thirty days; refresh-token reuse revokes the connection. Actual ChatGPT and Claude host acceptance remains untested.

| Surface | Evidence | State |
| --- | --- | --- |
| Discovery, constrained ChatGPT registration, consent, code exchange, S256, exact redirect, state, resource, expiry and revocation | `npm run verify -- p05` | Local integration |
| Authenticated guide/start/list/read/record/finish, prompts and historical pinned resources | `test/mcp.test.ts`; local lane transcript and projection | Local integration |
| Two OAuth clients, same local subject; different email identities isolated | Local lanes 2/3 | Local integration |
| Double reauthenticated explicit linking, old account tokens revoked | Local linking receipt | Local integration; existing-hunt migration intentionally refused |
| Bound read grant expiry, renewal, revocation, account/hunt/session and tombstone denial | Local lanes 6/7 and incarnation receipt | Local integration |
| Fresh same-account browser Stop/Skip and atomic replay | `npm run verify -- p07-controls` | Local HTTPS/PostgreSQL integration |
| Live React card, bridge, polling, grant rotation and native controls | `npm run verify -- p07-card`; local browser screenshots/video | Local Chromium integration; real hosts UNTESTED |
| Live Resend delivery and remote production deployment | Requires verified Resend sender, API key and issuer TLS/DNS | UNTESTED |
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

Production boot: follow [operations](operations.md). In short: run `npm ci`, `npm run build`, then `DATABASE_URL=… npm run db:migrate`, which refuses with exit 78 unless the release digest verifies. Supply `DATABASE_URL`, `SCOAT_AUTH_CONFIG` and `SCOAT_CONTROL_CONFIG` (private JSON files), `SCOAT_TLS_KEY`, `SCOAT_TLS_CERT` and `PORT` to `npm start`. The issuer config has `issuer` (HTTPS origin), `loginMailKey`, `loginMailFrom`, `lifecycleKey` (persisted random secret, 64–256 characters), `lifecycleKeyVersion` (persisted version identifier), `cookieKeys` (persisted random secrets, at least 32 characters), `jwks` (persisted private signing keys), and `clients` (each has `client_id` and exact `redirect_uris`). The control config is `{version:1,keyId,secret}` with a 1–32 character alphanumeric/underscore/hyphen key ID and 64 lowercase hexadecimal secret characters. Replacing its key invalidates prior control links and confirmations. Credentials belong in private files, never in chat or committed config. The service creates its auth tables against the migrated durable schema. It refuses MCP traffic without issuer/mail/database configuration, and refuses authenticated service traffic over plaintext HTTP. Terminate TLS in the process; forwarded headers do not establish trust. Bind/expose the loopback listener through an appropriate local network arrangement only after real deployment verification.

Only the configured production origin and exact local socket Origins/Hosts are accepted; absent Origin remains valid for native clients. Foreign or empty Origins are refused. MCP JSON bodies are bounded to 64 KiB, custom authentication forms to 8 KiB, and issuer form parsing uses the maintained integration's parser limits. Hunt lists use a server-enforced maximum of 20 and SQL cursor pagination. Four canonical product tool names remain; Memory advertises strict profile/save/read/item variants; profile and save require a separate fresh browser approval. The production HTML resource is the bundled P07 React card. It reads canonical HuntView snapshots through app-only read capabilities and opens browser confirmation links for Stop and Skip. Text includes the same control hub link for hosts without app support. Watch uses the same browser link in the card and text, and is offered only with configured mail and an eligible public-price result.

A bearer token is verified against persisted active token/session/grant records, exact resource, scope, expiry and active account incarnation before dispatch. Read-only tokens cannot write hunts. Read capabilities store only a secret digest and bind account, incarnation, hunt, OAuth session, read permission and five-minute expiry. Renewal atomically revokes the predecessor and inserts its replacement. They confer no Person authority. Open `/account/link` in a browser and freshly sign in with the existing identity. Confirm the link using the single-use same-origin form, then freshly sign in with the candidate identity. No bearer header is required for browser navigation. A browser-bound challenge, purpose, same-origin POST and Secure HttpOnly SameSite cookie bind the flow. Candidate accounts with existing hunts or other identities require a separate migration. A moved identity’s empty old account is retired under its exclusive account fence, so previously authenticated requests cannot write orphan hunts.

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

Sign up and log in at https://mcp.scoat.net/login. Scoat sends six-digit sign-in codes through Resend. Codes expire after ten minutes; browser sessions last thirty days. Connecting ChatGPT or Claude reuses that session before Allow/Deny consent. Sensitive actions require a fresh code.
