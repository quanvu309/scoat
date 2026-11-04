# Implementation notes

Design intent moved out of the code. The code has no comments; names and interface tests carry meaning.

## src/card/index.ts

- **CardState**: The card renders HuntView and nothing else. No pricing, checklist or wording logic lives here.
- **CardBridge**: The bridge surface the card needs. Backed by @modelcontextprotocol/ext-apps App.callServerTool.
- **mountCard**: Running: progress bar, one row per checklist item (tick, dot while checking, empty circle next, skipped, gap), best so far, buttons Stop here and Skip a place. Done: breakdown with a source per line, You pay today, Back later on its own line, Open ready link, Watch for £X.
- **mountCard**: TODO Poll scoat_card {op:"poll"} every 3 s while visible and running; stop polling when final is finished.
- **mountCard**: TODO Back off on failure and show "offline" with the last view; never guess state.
- **mountCard**: TODO Buttons send scoat_card {op:"act"} with a stable requestKey per click, so retries do not double-apply.

## src/delivery/index.ts

- **Recheck**: What a daily recheck saw on a recorded public link. Blocked or ambiguous pages are unknown and never trigger email.
- **readyLink**: Clean outbound link to the winning quote's product page, plus the steps to claim. Never tagged, never a checkout or payment, never overwrites cashback tracking.
- **recheck**: Fetches one recorded public page within its terms. No searching.
- **email**: Transactional outbox. The key makes resends safe; the provider must honour it.

## src/domain.ts

- **module**: Shared domain values. Never SDK, storage or OAuth wire objects. Brands are minted only by boundary parsers.
- **RowRevision**: Per-row optimistic concurrency token. Rows never share a revision, so parallel rows never conflict.
- **Money**: Non-negative safe integer pence. Percent reductions round down once per line.
- **Proof**: Every claim carries where and when it was seen. There is no constructor without both.
- **Status**: Only `confirmed` can enter a guaranteed total.
- **Intent**: What she asked about. The variant is pinned so offers for other sizes or colours are rejected.
- **Profile**: Her declarations, snapshotted into each hunt. Context, never proof that an offer applies.
- **OfferInput**: An offer always has a value. "No price found" is a row outcome, never an offer with an invented zero.
- **Selection**: A combination the agent wants priced. Delivery is mandatory: no proved delivery, no known pay-today.
- **PayToday**: Pay-today and back-later are separate ledgers with no shared total.
- **Quote**: Priced only by the server. Budget fit uses pay-today only; cashback and points never touch it.
- **Agent**: Minted from OAuth; never from tool input.
- **Person**: Minted only from authenticated same-account browser confirmation or a proven trustworthy host control channel. App visibility and arbitrary grants are not authorization. P01 always refuses.
- **Failure**: Every refusal tells the agent what to do next and carries current state when it helps.

## src/hunt/index.ts

- **CheckOutcome**: What the agent reports for one slot of one row. One op covers "found", "nothing" and "could not check".
- **HuntView**: The one projection. The card, the text fallback and the agent's next step all come from this value.
- **directive**: Tells the agent exactly what to do next.
- **checkEvidence**: Evidence boundary (graft from candidate B). Pure.
- **checkEvidence**: TODO HTTPS public URL; observedAt not in the future (allow skew) and within row.freshnessSeconds.
- **checkEvidence**: TODO Variant must match intent.variant when pinned; otherwise refuse with next: "check the right size".
- **checkEvidence**: TODO Discount with code from a non-official source => force status untested (never trust caller status).
- **checkEvidence**: TODO Distinct-seller rows: a seller already used in another slot of this row is refused.
- **priceQuotes**: Pricing (graft from candidate A). Pure. The agent never supplies totals.
- **priceQuotes**, **pickBest**, **finishable**, **renderView**: Implemented pure P03 behavior is defined in the P03 section below. Untested leads do not become conditional discounts. Exact complete offer sets are the compatibility authority. Text is regenerated from HuntView.
- **Hunts**: The only writer of hunt state.
- **run**: TODO Replay receipt by (account, requestKey) before anything else; different digest => key-reused.
- **run**: TODO start: read latest release, snapshot profile (request.profile ?? saved profile), build checklist rows.
- **run**: TODO list: recent hunts for this account, for resume in another chat or host.
- **run**: TODO record: refuse if row skipped by person or hunt finished; checkEvidence each offer; CAS the row.
- **run**: TODO   on conflict return Failure{conflict, next:"read the hunt and retry this row"} with no partial write.
- **run**: TODO   after Stop, reject every found outcome, including corrections; accept named gaps. Stop does not cancel the host process.
- **run**: TODO finish: transact lockAll; finishable(rows) else Failure{incomplete, next: names open rows};
- **run**: TODO   priceQuotes + pickBest (or the selection); mint the ready link via delivery; store final.
- **run**: TODO Every reply is the fresh renderView, so the agent always sees the directive.
- **control**: Person controls from the card. Skip is sticky and wins over same-row evidence. Stop asks the agent to name gaps and finish.
- **inspect**: Card poll. Read-only.
- **finished**: @internal Used by memory to freeze a finished hunt for saving and watching.
- **erase**: @internal Called by the erasure flow in memory.

## src/hunt/store.ts

- **SlotRecord**: @internal Owned by hunt/index.ts only. No other module may import this file. Storage model (base from candidate C): one record per row with its own revision, so parallel subagents on different rows never conflict. Finish locks every row of the hunt in one transaction.
- **skippedByPerson**: Sticky. Written only by Hunts.control. Wins over any agent write to the same row.
- **Receipt**: Same key + same payload digest replays the stored reply. Same key + different digest is refused.
- **putRow**: Fails with conflict when the stored revision differs. Increments revision on success.
- **transact**: Serializable transaction. `lockAll` takes every row lock of a hunt (finish, stop).

## src/index.ts

- **module**: The only public entry. hunt/store.ts and other internals are not exported.

## src/knowledge/index.ts

P02 implements this module. See the P02 immutable knowledge section below for validation, publication, rendering and provenance.

## src/mcp/index.ts

P01 now implements strict wire contracts and unavailable/forbidden dispatch. Request types, tool names, descriptions and schemas derive from `toolCatalog`. The SDK's high-level listing loses root discriminated unions; the MCP adapter therefore installs registry-derived list/call request handlers and emits draft-7 object schemas with strict union branches. Invalid inputs receive a fixed error before dispatch, without reflecting private input. Domain functions remain SDK-free and are not called until their implementation phases.

`person()` and `authenticate()` fail closed. App visibility and result metadata are not authentication. See [host support](host-support.md) for the observed compatibility and blocked host gates. The fixture HTML is embedded in the compiled MCP module and served as an MCP App resource; it is not the P07 interactive card. P02 adds the shared knowledge prompt and immutable Markdown resources described below.

## src/memory/index.ts

- **MemoryView**: Same account in Claude and ChatGPT sees the same view.
- **Memory**: The only writer of profile, saved items and watches.
- **run**: TODO Idempotent by (account, requestKey) like hunts.
- **run**: TODO save/watch freeze a finished hunt via hunts.finished; watch requires a verified email and her request.
- **run**: TODO watch target compares known pay-today only. unwatch is sticky; re-watching makes a new id.
- **run**: TODO erase: fence the account, then hunts.erase, then profile, saved, watches, outbox, receipts.
- **recheckDue**: Daily scheduler entry. Per-watch daily key tolerates crashes and multiple workers.
- **recheckDue**: TODO For each active watch: delivery.recheck on the recorded link only. Unknown => record, no email.
- **recheckDue**: TODO Email when known pay-today <= target AND better than last notified. Cashback alone never triggers.
- **unsubscribe**: Signed unsubscribe link from the email; cancels one watch, returns nothing.
- **profileOf**: @internal Read by Hunts at start when the request carries no profile.

## P01 foundation

Use Node 24.21.0 and the committed npm lockfile. Run `npm ci`, `npm run build`, then `npm start`. The fixture server binds only `127.0.0.1:3000` (`PORT` overrides it), exposes stateless Streamable HTTP at `/mcp` and process readiness at `/healthz`. A ready process does not imply working shopping, OAuth, database or email. The response declares those limitations. No external deployment is supported in this phase.

`npm run verify -- doctor` launches a disposable compiled server, reads readiness, then closes it. `npm run verify -- p01` launches its own process on an ephemeral loopback port and exercises ten declared scenarios. `--lane 1` through `--lane 10` select one. CLI transcripts are primary evidence under `~/tmp/scoat-delivery/p01/run-*/lane-*/transcript.json`; no UI screenshots are claimed. Lanes 6 and 7 remain UNTESTED without real host sessions; lane 8 is PARTIAL with an isolated session-binding fixture, not production authentication. The summary always distinguishes fixture checks from full P01 verification. `SCOAT_EVIDENCE_DIR` selects an absolute evidence directory. Cleanup stops only the child processes each run created and preserves evidence.

`npm run perf -- p01` records five batches of 100 sequential warm raw-client HTTP calls, ten warmup calls excluded, with runner details and raw samples. It checks the proposed 500 ms p95 ceiling locally. Trunk lacks the HTTP operation, so the baseline is unavailable and no speedup ratio is calculated. The fixed 2-vCPU acceptance gate is untested on other hardware. Build success is checked separately by CI. No network service is called by verification or perf.

The HTTP adapter accepts absent Origin headers for native clients and explicit loopback HTTP origins at the exact local socket port. Other present Origins receive 403. The raw HTTP protocol test covers this boundary; the structural check rejects missing, empty or foreign origin allowlists.

For disposable dependencies on a Docker-capable machine, choose an unused project and ports for each lane:

```sh
export DB_PORT=54329 MAIL_PORT=8025 SMTP_PORT=1025 SHOP_PORT=8089
export DATABASE_URL=postgres://scoat:fixture-only@127.0.0.1:54329/scoat
docker compose -p scoat-p01-lane1 up -d --wait db mailpit fixture-shop
npm run db:migrate
npm run db:seed -- --fixture p01-lane1
```

`db:migrate` runs the checked-in Drizzle migration journal under an advisory lock. `db:seed` inserts one idempotent UK/GBP fixture-lane marker and prints the stored row. Neither creates fake account identities or shopping results. Both require the explicit lane DSN. The HTTP foundation does not require these dependencies yet. Mailpit captures local email only; P01 sends none. The seller's `/product` route is fixture data, not a production recheck transport; it is never imported into `src/`. A future recheck adapter must stay fixture-only. Stop dependencies with `docker compose -p scoat-p01-lane1 down -v` using the same selected ports/environment. Remove only the lane's volumes. Docker/Compose execution is untested in environments without Docker.

`npm run start:worker` exits nonzero with an explicit P08-unavailable message. GitHub Actions runs install, build, typecheck, lint, tests, repeated Postgres migrations/seeds, HTTP verification and perf on standard `ubuntu-latest`. No runner registration, caches, uploaded artifacts or external services are configured. CI's fixture passes do not discharge the real-host gates.

## P02 immutable knowledge

`knowledge/releases/gb-method-2026-11-04.json` is the production seed. It contains eight rows and eleven total slots: four distinct other sellers and seven single-slot places. Eligibility never removes a row. Future hunt recording must enforce distinct seller identities and resolve every slot as checked, person-skipped or a named gap. P02 does not implement recording, identity or totals.

### Validate, publish and refresh

Build with `npm run build`. Import `Knowledge`, `validateRelease` and `auditSources` from `dist/knowledge/index.js`. Validate external JSON with `validateRelease(raw, new Date().toISOString())`. Publication runs that validation again. Use `await new Knowledge(directory).publish(raw)` for a writable release directory; omitting the directory uses the checked-in production directory. No model tool exposes publication. Commit reviewed seed releases into `knowledge/releases` for packaged deployment, or persist a writable directory across process restarts. Redeploying only the checked-in files cannot retain unpublished local files.

Publication writes a unique temporary file exclusively, then atomically hard-links the complete file to the final ID with no overwrite. A competing identical publication converges; conflicting content fails. Temporary files are cleaned after publication attempts; crash-left `.pending` files are ignored by lookup. Files must remain on the same filesystem. Atomic visibility and process restart persistence are provided; power-loss durability and external administrator edits are outside this boundary. No database is involved.

The ID must match its filename. Latest is chosen by published timestamp then ID; pins always name an exact ID. Reused IDs are compared after strict schema normalization. Read validates historical files at their publication time, so a once-valid pinned release stays reproducible after expiry. Publication validates against current time. Parsed content is recursively frozen, including row slot arrays and facts; mutations of caller input cannot alter files or prior snapshots.

`renderGuide` provides one canonical Markdown body for tool, prompt, resource and skill exports. It deliberately does not depend on wall clock. Every output warns that pinned facts are historical, requires checking expiry, and excludes unknown/expired claims from confirmed offers. `auditSources` separately takes an explicit current instant and reports freshness without rewriting a pin. `isOfficialSource` also requires an explicit current instant. A student declaration never verifies eligibility. Third-party code facts cannot be published as confirmed.

Published source URLs follow the [production source register](../knowledge/sources/README.md): HTTPS DNS names with lexical nonpublic-host rejection. The boundary does not perform network requests or guarantee DNS reachability. Synthetic fixtures use example-domain URLs and never supply production facts.

### MCP surface

`scoat_guide` returns the canonical method, release ID, complete rows, scoped facts and named shop gap over compiled HTTP. Prompt `hunt-best-benefit` accepts an optional shop. Read the default guide or skill Markdown at `scoat://knowledge/<release>/guide` and `scoat://knowledge/<release>/SKILL.md`. Registration snapshots releases at process startup. Every release present on disk gets its own pinned guide and skill resource; restarts retain old URI content while the default tool and prompt advance to latest. Rendering a historical pin is also supported by `Knowledge.read` plus `renderGuide`. There are exactly four product tools. Hunt, memory, OAuth and person/card controls remain denied or unavailable. Exact Origin protections are unchanged.

The raw prompt handler parses the strict `promptInput` schema before rendering. Unknown arguments and unknown prompt names return invalid-params errors. Tool and prompt boundaries both reject extra fields; high-level SDK prompt registration is banned because it strips them.

### Evidence and limits

`npm test` covers invalid row configurations, duplicate sellers, dangling/expired facts, provenance, declarations, third-party codes, mutation, reused IDs and restart pinning. `npm run verify -- p02` records ten deterministic service/module scenarios, including actual HTTP tool/prompt/resource retrieval. JSON transcripts are primary evidence, not UI screenshots or real-host verification. P01 lanes 6/7 remain UNTESTED and lane 8 PARTIAL. No model-agent lane or UI completion is claimed.

`npm run perf -- p02` measures validation of a synthetic 100-shop release and guide rendering for each of its shops, with eight shared row recipes per shop, in five batches after warmup. Every measured operation validates its output. File I/O, startup, build, installation and network are excluded. P01 has no equivalent operation, so no speedup ratio is meaningful. The local 100 ms budget is checked; the fixed two-vCPU gate remains untested on this host.


## P03 pure evidence, pricing and projection

`src/hunt/index.ts` exports the pure evidence, pricing and view modules. MCP uses the same strict evidence and selection schemas, but hunt commands remain unavailable pending P04. Authenticated controls remain denied pending P05.

Evidence accepts exact seller and nonempty variant attestations at an explicit UTC time. Maximum age is 24 hours, future skew is zero, and an expiry at or before now is rejected. P02 public-source validation checks lexical HTTPS DNS provenance; it does not resolve DNS, fetch retailer pages or certify truth. Code leads remain untested. A retailer-tested code requires a current confirmed official-domain fact in the pinned release matching its proof hostname; the caller-supplied origin label alone grants no authority.

Compatibility authorizes one complete selected offer-ID set including price and known delivery. All references resolve to current observations of the same seller and variant. No pairwise transitivity or arbitrary unbound proof can authorize a larger set. This phase implements offer-ID authority, not immutable-fact authority.

Discounts run by ascending explicit order then offer ID. Percentages floor each line in integer pence; basis is original item, remaining item or remaining delivery. Fixed discounts affect remaining item. Each discount clamps to its target balance. Minimum spend uses original item price. Exact BigInt intermediates protect multiplication and addition; the final GBP amount must be safe. Enumeration considers valid subsets before ranking by pay-today, then more evidenced benefits, then sorted offer IDs. Quotes tie by stable anchor ID. Cashback, points and perks belong only to their selected supported scenario and never lower pay-today.

At most 16 benefits per anchor are composable. A seventeenth produces a named incomplete-optimum limitation and excludes the quote from best selection. Delivery absence remains unknown, including budget fit. Conditional steps and budget comparisons are separate from guaranteed totals. Each conditional scenario retains its exact selection, later rewards and perks; rewards from an incompatible scenario cannot leak into it. Untested leads stay visible.

Row slots structurally record checked proof, named gap or pending status; person skip belongs to the row. Missing, duplicate or unexpected slots remain unresolved. Other-seller slots require four distinct sellers excluding the original shop, with trimmed case-insensitive identity comparisons; explicit named gaps and person skips remain valid resolutions. All eight release rows survive every profile state. One HuntView owns all quotes, progress, gaps, directives, clean product links and money, including losing scenarios, unknown delivery and incomplete-optimum limitations. Its text renderer receives only that projection.

Run `npm run verify -- p03` and `npm run perf -- p03` after build. These are compiled synthetic module checks. Separate model-agent and real-host sessions and fixed two-vCPU performance acceptance remain required external gates.
