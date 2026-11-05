# Sealed-source recovery

Recovery moves Scoat from one PostgreSQL database to a fresh one. Only a surviving, genuine live database can authorize it. Run `node dist/recovery.js <command>` (or `npm run recovery -- <command>`) from the release directory. Release readiness, the systemd units and key rotation are in [operations](operations.md).

## Supported sequence

1. Run `status`, then `seal` against live. New feature transactions refuse and requests return 503 `sealed`. Stop the worker before taking the dump so pg-boss supervision cannot change the queue during backup. An idle worker may continue queue supervision until stopped; a feature transaction refusal exits it with 78. Record the printed `sealId`.
2. Create an empty database for the target, owned by the application role.
3. Run `restore --archive <absolute path>`. It refuses before running any tool when the source and target are the same database, the source is not sealed or already consumed, the target is not empty, or the archive path exists. It then runs `pg_dump --format=custom` of the whole source database and `pg_restore --single-transaction` into the target, and checks that the target carries the same seal. The restored target stays quarantined: no runtime admits it.
4. Run `admit`. It migrates the target in one transaction under its exclusive lineage lock, consumes the source once for this target, then binds the target as admitted. Start the server and worker on the target.

A backup taken before the seal is never admitted (`archive-not-sealed`). Once the source is consumed, `unseal` always refuses, even if the target looks unadmitted: only completing that target is supported, and losing it strands the source.

## Environment

| Name | Used by | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | `status`, `seal`, `unseal` | Live database |
| `SCOAT_SOURCE_DATABASE_URL` | `restore`, `admit` | Sealed live database |
| `SCOAT_TARGET_DATABASE_URL` | `restore`, `admit` | Fresh target database |
| `SCOAT_PG_BIN` | `restore` | Absolute directory containing `pg_dump` and `pg_restore`, at least the server major version |
| `SCOAT_PG_LIB` | `restore` | Optional absolute library directory for those tools |

Use the same `options=-c search_path=<schema>` on both URLs when the application schema is not `public`. Tools receive the connection without its password; the password goes only into the child environment. Output never contains connection strings.

## Results and retry

Success prints one JSON line. Refusals print `{"event":"recovery_refused","reason":...}` to stderr and exit 78; usage errors exit 64; unexpected failures exit 70 with a bounded message.

| Interrupted at | Rerun `admit` |
| --- | --- |
| Before or during migration | Migration rolled back; the source is unconsumed. Rerun, or `unseal --seal <id>` to resume live |
| After consumption, before bind | Resumes the same target, recognised by its pre-bind physical identity |
| After bind | Returns `already-admitted`, confirmed against the source's consumption record |

A failing migration returns `migration-failed` with its SQLSTATE and leaves the target unchanged and the source unconsumed. A second logical target, a logical copy of an admitted target, or a target restored before a reseal is refused.

## Not supported

Total loss of live, rolling live back to a snapshot, restoring only some tables, restoring over live, and recovery without the post-backup erasure and mail history. These are not detectable in every case; do not attempt them.

A cold physical clone, storage snapshot or pg_basebackup copy can preserve all checked identity fields. Starting one in parallel with live is forbidden: both can be admitted. Detection is limited to the tested logical restore and identity-changing copy paths.
