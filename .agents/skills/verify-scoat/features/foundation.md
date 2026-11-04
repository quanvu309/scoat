# P01 foundation verification

Run this branch after transport, registry, authorization-denial, fixture-resource or driver changes. Build first using the parent skill's common steps.

1. Run `npm run verify -- p01`. Read the printed directory and `summary.json`. For a targeted rerun, use `npm run verify -- p01 --lane N` with N from 1 through 10.
2. Inspect all ten lane transcripts: (1) readiness and current guide; (2) exactly four registry tool schemas; (3) strict forged-input rejection; (4) ordinary-client card control denial; (5) static app MIME/CSP; (6) app-host session; (7) text-host session; (8) confirmation session-binding spike; (9) process restart/reconnect; (10) sanitized logs and honest host matrix.
3. Run `npm run perf -- p01`. Inspect five batches of 100 local HTTP guide calls and their raw samples. Each local p95 must be at most 500 ms; report the runner shape separately from the fixed two-vCPU gate.
4. Complete the parent skill's typecheck, lint and test commands. Protocol tests must preserve foreign-Origin rejection, exact loopback Origin acceptance, strict wire inputs and denied person/card authorization.

PASS requires successful assertions and saved transcripts for lanes 1–5, 9 and 10. Lane 1 now returns P02 guidance; hunt and memory execution remain unavailable. FAIL identifies an executed assertion or command failure. UNTESTED identifies missing session/environment evidence. Lanes 6/7 remain UNTESTED without real host/version sessions. Lane 8 remains PARTIAL: the isolated fixture proves session binding, while production OAuth/browser confirmation remains UNTESTED. A raw Client or static HTML resource cannot discharge those gates. Do not claim full P01 verification from a zero exit code. The fixed two-vCPU performance gate remains UNTESTED on another runner shape.

The driver starts the compiled server on its own ephemeral port and closes it, including the restart lane. It needs no database or mail dependency. The app resource is static HTML without an interactive bridge. No account is created and no nonce authorizes production mutations.
