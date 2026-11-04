# Lineage and runtime admission (P09 S1)

Run `npm run build`, then `pstack-run run --timeout 600 -- npm run verify -- p09-lineage`. It needs the shared PostgreSQL 17.6 binaries used by P04 (or `DATABASE_URL` with a role that may create roles and databases) and PostgreSQL client tools at least as new as the server: `SCOAT_PG_BIN` and `SCOAT_PG_LIB`, defaulting to `~/.local/pg/root`. The lane creates a non-superuser owner role and disposable databases, removes them afterwards, and writes `receipt.json` under `~/tmp/scoat-delivery/p09/s1/lineage-*`.

This is S1 only. The sealed two-database handoff (consume and bind), the recovery CLI, deployment units, health digest and the public P09 acceptance story do not exist yet. Do not report P09 as verified from this branch.

## Lanes

1. Populate a live schema through admitted owners: accounts, a hunt, a watch, a pending alert, queued check and send jobs, and expired maintenance rows.
2. R1: `pg_dump -Fc` the whole live database and restore it into a fresh database. The server, the fixture worker and `dist/worker.js` exit 78 with `identity-mismatch`. Fenced maintenance and admission refuse. Every row digest, the catalog and function digests, and seller and mail request counts are unchanged.
3. R1 negative: the base unfenced maintenance DELETE does mutate that copy, so the digest assertion detects the base boot shape.
4. R5: with a running server and worker, seal live. Health, MCP and OAuth discovery return 503 with `sealed`; a fenced write refuses; the worker exits 78 on the next job with no new seller or mail request. Unseal restores 200/401/200.
5. R5/R7: a data-only reload of the lineage table differs only in row xmin. Requests return 503 `identity-mismatch` and transactions refuse. An identity without xmin would have admitted it.
6. R6: an open fenced transaction blocks seal on the advisory key (80109, schema hash), shown in `pg_locks`. Schema B commits meanwhile; a new schema A transaction times out behind the seal. The holder's write precedes the seal, and later writes refuse.
7. R6 negatives: a database-wide key blocks schema B, and an opener without the shared lock lets a write commit after the seal.
8. An admitted capability from schema B cannot open the queue on schema A or on another database.
9. Unseal works before consumption. After an emulated S2 consume, unseal refuses `consumed`; the original unconditional unseal would reopen it.
10. A top-level lineage write keeps admission; the same write inside a savepoint strands the schema on row xmin.
11. A pristine `db:migrate` install is admitted; a template clone carrying `admitted` is refused on database oid.
12. A 0003-only database refuses with `schema-behind`. Populated P08 data migrated to 0004 refuses with `populated-without-lineage`, and its digest stays unchanged.

`npm test` adds parser checks in `test/lineage-lint.test.mjs` with original bypass shapes: raw `BEGIN` sites, bare pool writes, savepoints, lineage SQL outside its owner, hold order, an unscoped key, unseal without the consumption predicate, identity without xmin, and the base server and worker boot order.

## Labeled limits

These are FORBIDDEN and undetectable, never passes: selective data-only restore that excludes lineage, snapshot rollback of live, and owner-role recomputation of the bind expression. In-place `pg_restore --clean` fails closed and strands live. Managed PostgreSQL permissions and failover are UNTESTED; a permission failure refuses with `identity-unavailable`.
