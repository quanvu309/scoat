# Durable hunts

Load this branch only for P04 store, command, receipt, lifecycle or account-fence changes.

Run npm run verify -- p04 and npm run perf -- p04 after building. The first drives compiled commands against PostgreSQL and uses harness-owned transaction barriers. Contended barriers must retain SQLSTATE 55P03 from NOWAIT probes on the protected resource before releasing the holder; a hook reached before a lock query is insufficient. Disjoint-row lanes must progress while the holder remains paused. The second measures eight clients over 100 hunts with five measured warm batches, retaining every operation. DATABASE_URL selects a disposable caller-owned database; otherwise the driver initializes and removes task-owned native data and sockets, retaining server logs.

Source pointers: src/hunt/postgres.ts owns fences and atomic receipts; src/hunt/index.ts owns commands; db/migrations/0001_hunts.sql owns foreign keys. scripts/verify-durable.mjs defines deterministic lanes; scripts/perf-durable.mjs defines workload and acceptance. Preserve earlier branches when shared schemas, projection or adapters change.

Record exact head, status, PostgreSQL version, each lane, contention probes and raw performance receipt. Include the unspecified-shop lane: evidence infers the original seller, rendered coverage completes, and finish succeeds with the same decision. PASS requires all assertions and local p95 at most 500ms without loss, duplicate mutation, cross-account reads or excessive retries. Failure is FAIL with log paths. Ten model-agent/real-host sessions and fixed two-vCPU acceptance remain UNTESTED without their own evidence; compiled lanes cannot substitute for them.
