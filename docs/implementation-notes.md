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
- **Person**: Minted only from a verified app-only grant. An agent cannot construct one.
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
- **priceQuotes**: TODO Baseline quote per seller: its price + its delivery (missing delivery => PayToday unknown, never zero).
- **priceQuotes**: TODO Add confirmed same-seller discounts only where a stacking fact allows or stackProof shows it.
- **priceQuotes**: TODO needs-step / untested lines go into `conditional` scenarios, never into `guaranteed`.
- **priceQuotes**: TODO cashback and points go only into backLater; budget fit compares pay-today only.
- **priceQuotes**: TODO Apply reductions in fact order on the declared basis, clamp at zero, round down per line.
- **pickBest**: Lowest known guaranteed pay-today, then lowest conditional, then stable quote id.
- **finishable**: Finish gate. Every row must be done, person-skipped or a named gap.
- **renderView**: Builds the projection, including `text`. Text is always regenerated, never stored.
- **renderView**: TODO Text: one line per row (tick / checking / next / skipped / gap), best so far, then on finish the
- **renderView**: TODO breakdown with a source per line, pay today, back later on its own line, gap to budget, steps to claim.
- **renderView**: TODO Unknown prints "unknown", never £0.
- **Hunts**: The only writer of hunt state.
- **run**: TODO Replay receipt by (account, requestKey) before anything else; different digest => key-reused.
- **run**: TODO start: read latest release, snapshot profile (request.profile ?? saved profile), build checklist rows.
- **run**: TODO list: recent hunts for this account, for resume in another chat or host.
- **run**: TODO record: refuse if row skipped by person or hunt finished; checkEvidence each offer; CAS the row.
- **run**: TODO   on conflict return Failure{conflict, next:"read the hunt and retry this row"} with no partial write.
- **run**: TODO   after stop, accept only gap outcomes and corrections, not new searches.
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

- **Fact**: Curated by the Scoat team from public sources. Agents never write facts.
- **RowRecipe**: One recipe per checklist row. `slots` > 1 means N distinct sellers, not N checks of one seller.
- **Release**: Immutable release: playbooks and facts publish together, so a hunt pins one id and never mixes revisions.
- **Guide**: What the agent reads. The MCP prompt, the resource, the guide tool and the skill file are all this.
- **renderGuide**: The only renderer of playbook text. Prompts, resources, scoat_guide and SKILL.md exports call it.
- **renderGuide**: TODO Render rows in order with method, proof required and stop rule; include shop facts with source dates.
- **renderGuide**: TODO Tell every worker: read the hunt before each external search; obey the directive.
- **renderGuide**: TODO Claude Code / Codex section: rows may be split across subagents, one row per subagent.
- **checklist**: The only constructor of a checklist. Profile never silently removes a row; inapplicable rows need a proved "none".
- **isOfficialSource**: Code provenance is decided by attested domains, never by a caller flag. Code-site codes are always untested.
- **publish**: Team-only. Rejects a release with dangling fact ids, duplicate rows, a missing place, or expired facts. Never an MCP tool.
- **publish**: TODO Validate: every Place covered once, fact references resolve, distinct-seller rows have slots >= 1,
- **publish**: TODO stacking facts reference existing facts, validUntil in the future. Content-address the id.
- **read**: "latest" is for discovery only; hunts always read their pinned id.

## src/mcp/index.ts

- **CardRequest**: App-only. The grant arrives in hidden tool-result _meta for the bound card; it is never in model-visible content.
- **module**: The one tool registry. tools/list, schemas, visibility and descriptions all derive from it.
- **module**: MCP prompt and resources. Each body comes from knowledge.renderGuide; there is no second copy.
- **schemas**: Zod schemas emitted as MCP JSON Schema. Parse unknown straight into branded domain values.
- **schemas**: TODO Strict keys; GBP integer pence; HTTPS urls; UTC times; bounded text and arrays.
- **schemas**: TODO Reject any account, actor or person field in input. Outputs: structuredContent + text content.
- **authenticate**: OAuth issuer+subject maps to one Scoat account across Claude and ChatGPT.
- **person**: Verifies the app-only grant: bridge session, account, hunt, expiry, allowed actions. Unsupported hosts get read-only text.
- **mount**: Wires the SDK. Dispatch is one switch to the owning module; no business logic here.
- **mount**: TODO registerTool for guide/memory; registerAppTool for scoat_hunt with _meta.ui.resourceUri = ui://scoat/hunt.html.
- **mount**: TODO registerAppResource for the card bundle (text/html;profile=mcp-app), restrictive CSP.
- **mount**: TODO Every scoat_hunt result: structuredContent = HuntView, content = view.text, _meta.grant = fresh app grant.
- **mount**: TODO scoat_card: poll -> hunts.inspect; stop/skip -> hunts.control; watch -> memory.run(person).

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
