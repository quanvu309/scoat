# Sealed-source recovery (P09 S2)

Read [lineage](lineage.md) first; recovery extends its owner and fence. The operator contract is [docs/recovery.md](../../../../docs/recovery.md).

Run `npm run build`, then `pstack-run run --timeout 1200 -- npm run verify -- p09-recovery`. It needs the shared PostgreSQL 17.6 binaries used by P04 (or `DATABASE_URL` with a role that may create roles and databases), client tools at least as new as the server in the required absolute `SCOAT_PG_BIN` (with optional `SCOAT_PG_LIB`). For the base-artifact reproduction it `git archive`s `6ec8b75` into the lane scratch and compiles it there, labelled in the receipt; dependencies come from the checkout when the lockfiles are identical, otherwise from `npm ci` inside that scratch. `SCOAT_BASE_APP` is an optional override whose lockfile must match. The lane creates a non-superuser owner role and disposable databases, removes them, and writes `receipt.json` under `~/tmp/scoat-delivery/p09/s2/recovery-*`. Also run `npm run verify -- p09-lineage` for R5, R6 and R7.

## Gates

1. R2 setup: back up live as B0, then accept alert K1 and erase account X through the browser.
2. R2: restore B0 with raw tools. `admit` refuses `archive-not-sealed`; the server, the fixture worker and `dist/worker.js` exit 78; `restore` from the unsealed live refuses `source-not-sealed` without creating the archive. The digest and outbound counts are unchanged.
3. R2 original shape: the base `6ec8b75` worker on that restore delivers a second key for the same drop and mails the erased address. BLOCKED, never PASS, if the base artifact cannot be built.
4. R3 setup: accepted K1, an ambiguous `submitting` alert whose provider response was lost, a pending alert and a past-deadline ambiguous alert (synthetic deadline), all with queued sends.
5. R1: a raw full restore of admitted live refuses the server and both workers before effects; digests, queue jobs, maintenance rows and outbound counts are unchanged. `restore` with source equal to target refuses `same-database`.
6. R4b: seal, `restore`, then admit with a failing next migration. It refuses `migration-failed` with SQLSTATE 22012; the target digest, including its installed journal, is unchanged; the source stays sealed with `consumedBy` null; `unseal` resumes it and a fenced write succeeds; the stale target then refuses `source-not-sealed`.
7. Handoff: seal, `restore` into two fresh targets with distinct locators. A populated target refuses `target-not-fresh` and a reused archive path refuses `archive-exists`, both before tools run.
8. R4 crash: a helper is SIGKILLed between source consumption and target bind. Live is consumed by the first target; that target is still unadmitted, yet `unseal` refuses `consumed`. The second target refuses `consumed` with an unchanged digest. Rerunning `admit` admits; a further rerun returns `already-admitted`; a template copy of the admitted target refuses `archive-not-sealed`; live health stays 503.
9. R3 replay on the admitted target with the real fixture worker and queue: K1 gets no new request; the ambiguous alert is re-requested with the same key and payload digest and still has one delivery; the pending alert is delivered once; the expired alert becomes `unconfirmed` (`retry-horizon`) with no request. Keys, payloads and deadlines equal the live snapshot. X has no watches, alerts, recipients, active account or jobs, no new mail, and the old token raises `InvalidCredential`.
10. R4 unseal before consumption: with admit paused after migration, `unseal` succeeds and the delayed source CAS refuses `source-not-sealed`. After a reseal, a CAS carrying the old seal refuses `seal-mismatch`.
11. R4 overlap: with the target bind paused inside its transaction, the target still reads unadmitted and `unseal` refuses `consumed`; after release exactly the target is admitted and the source stays sealed.
12. R4 negative: the original unsafe unseal (reopen when the target looks unadmitted) during the same pause leaves two admitted databases. Emulation on disposable databases.
13. R4b corrected: a failing next migration leaves the journal unchanged; the corrected one admits the same target and adds one journal row. The runtime schema head stays the artifact constant `0004_lineage`.

`npm test` adds `test/recovery-lint.test.mjs` (original unsafe shapes: unseal with a target exception, consume without the seal predicate, bind without the locator or source recheck, admit order swaps, restore that runs tools before checks or certifies itself, shell or password argv, loose argument parsing, missing routing) and `test/recovery-cli.test.mjs` (strict arguments, tool-version parsing, credential-free tool arguments, bounded diagnostics).

## Labeled limits

Losing the designated target after consumption strands the source by design. Selective restore excluding lineage, snapshot rollback and owner-role bind recomputation stay FORBIDDEN and undetectable. Real Resend same-key idempotency, managed PostgreSQL permissions and failover, restore under a different owner role name, and the fixed two-CPU runner are UNTESTED.
