# P01 compatibility and trust

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

`_meta.ui.visibility` is presentation metadata. Neither it, client-provided identity, arbitrary grants nor tool calls attest to a human gesture. `person()` always throws. Every card operation, including poll, is denied. No account principal is created. All other shopping operations return explicit unavailable errors and complete text; no prompt or knowledge resource promises an implemented guide.

The safe future default is a separately browser-authenticated same-account confirmation with session-bound, expiring, single-use nonce, Origin/CSRF checks, and an explicit POST. GET must never mutate. The isolated P01 fixture tests GET rejection and nonce/session binding; it does not implement OAuth or prove these production requirements. It is never imported by production source. No production switch enables the fixture.

The static HTML fixture tests resource delivery and restrictive CSP only. It has no bridge, controls, external connections or shopping state. Real rendering and trustworthy host controls remain UNTESTED. Readiness reports process/transport readiness; P01 has no runtime dependency on database or email. Remote HTTP is loopback-only and unauthenticated for local fixtures; external deployment is unsupported until P05.
