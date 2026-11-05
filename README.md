# Scoat

Find the best benefit from what she asks.

Scoat is a kit for Claude and ChatGPT. It teaches the agent to hunt every benefit (price, student discount, member perks, cashback, points, card perks), keeps it hunting until every place is checked, and shows her each step in a live card inside the chat. The agent sees, searches and talks. Scoat brings playbooks, curated shop facts, a hunt tracker, the card, and memory that lasts across chats and hosts.

Status: P09 platform draft, not deployed. It has durable PostgreSQL hunts, saved Memory, browser-approved commands, the live card, public Pi Hut price watches and coordinated erasure. It also has database lineage admission, sealed-source recovery, a release artifact digest, truthful `/healthz` readiness and systemd units. Every capability has local fixture evidence only.

Not yet done or not yet tried:
- The linked public P09 acceptance story and its independent reviews are still pending.
- Real hosts, a real IdP, Resend, DKIM, live sellers, checkout and production deployment are UNTESTED.

See:
- [operations](docs/operations.md);
- [recovery](docs/recovery.md);
- [host support and capability matrix](docs/host-support.md);
- [Memory and erasure](docs/memory-erasure.md).

Licensed under the [MIT License](LICENSE).

## Tools

| Tool | For | Does |
|---|---|---|
| `scoat_guide` | agent | The hunt method and shop facts, for hosts without prompts |
| `scoat_hunt` | agent | start, list, read, record, finish. Every reply carries the next step and the card |
| `scoat_memory` | reserved | No released operations |
| `scoat_card` | card only | open, read, renew and revoke a bound read capability; no Person controls |

## Where things are

| Path | What |
|---|---|
| `RATIONALE.md` | The architecture: usage, shape, synthesis decision, tradeoffs, open questions |
| `src/` | Type scaffold: domain, knowledge, hunt, memory, delivery, mcp, card |
| `docs/brainstorm.md` | How the idea evolved, the reviews, and every decision |
| `docs/implementation-notes.md` | Design intent per function, kept out of the code |
| `arch/` | The spec and the three candidate designs from the architecture arena |
| `design/boards/` | The canvas boards as images |
| `design/canvas/` | The Brilliant canvas source |
| `scripts/check-no-comments.mjs` | Fails the build on any comment in code |
| `deploy/` | systemd units for migrate, server and worker, and the placeholder environment file |
| `docs/operations.md` | Release digest, readiness, TLS, systemd, recovery, key rotation, retention and supported sellers |
| `docs/recovery.md` | The sealed-source recovery runbook |

## Boards

| Board | |
|---|---|
| ![Scoat](design/boards/01-scoat.png) | Find the best benefit from what she asks |
| ![Tools](design/boards/02-tools.png) | Four tools, one hunt |
| ![Card in hosts](design/boards/03-card-in-hosts.png) | The hunt card inside ChatGPT and Claude |
| ![Card states](design/boards/04-card-states.png) | Every state of the hunt card |
| ![Modules](design/boards/05-modules.png) | Modules |
| ![Monorepo map](design/boards/06-monorepo-map.png) | Monorepo map |
| ![Stack](design/boards/07-stack.png) | Stack |

## Checks

```sh
npm ci
npm run build
npm run typecheck
npm run lint
npm test
npm run verify -- p01
npm run perf -- p01
npm run verify -- p05
npm run perf -- p05
npm run verify -- p09-lineage
npm run verify -- p09-recovery
npm run verify -- p09-operations
npm run perf -- p09
```

The P09 recovery lanes need PostgreSQL client tools at least as new as the server, set as an absolute `SCOAT_PG_BIN`. Hosted CI installs the PGDG `postgresql-client-18` package and runs every P01–P09 lane listed in `.github/workflows/ci.yaml`.
