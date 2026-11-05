# MCP foundation

## Sub-features

Readiness (lane 1), exact registry schemas (2), rejected forgery (3), denied card controls (4), static app resource/CSP (5), process restart/reconnect (9), sanitized logs (10).

## How to get to it (user POV)

Start the local server with `npm start`, then connect an MCP raw Client to `http://127.0.0.1:3000/mcp`. This exposes only the fixture foundation; pending operations return unavailable.

## Driving it with the HTTP/MCP driver

Run `npm run verify -- p01 --lane 2`. The driver owns an ephemeral process and port. `tools/list` must contain exactly the four registry tool names and schemas. Run all lanes to cover the other sub-features. Inspect `lane-2/transcript.json` and the printed summary after process cleanup.

## Gotchas

The driver is not a real Claude/ChatGPT host. Lanes 6/7 are UNTESTED and lane 8 PARTIAL. The app is static HTML without a bridge. No account is created and no nonce can authorize production mutations. Process readiness is independent of future database/mail readiness.
