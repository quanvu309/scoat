# Scoat grounding (v0.7)

Greenfield. No existing code. This file is the whole spec the design must honor.

## What Scoat is

A headless MCP server (plus skill files) that plugs into Claude (claude.ai, Desktop, Claude Code) and ChatGPT (Apps SDK, Codex). It has no app of its own.

Job: **find the best benefit from what the person asks** ("any deals on these?" with a product link, a photo, or a question). Benefit = price, student discount, member perks, cashback, points, card perks, delivery, price match.

Principle: **if the agent can do it, the agent does it.** The host agent sees images, searches the web, fetches pages, reasons and talks. Scoat only provides what agents lack:

1. **Playbooks** - the hunt method per job: where benefits hide, in what order, how to prove each, when to stop. Served as MCP prompts, skill files, and a tool for hosts without prompt support.
2. **Benefit facts** - curated, condensed facts per shop/programme: which student scheme, online vs in store, what stacks, price match policy, cashback sites, member perks. Maintained by the Scoat team from public sources, versioned.
3. **Hunt tracker** - each hunt has a checklist of places to check. The agent logs finds; Scoat says what is left. Hunts resume across chats and across hosts (same person in Claude and ChatGPT). This is what keeps the agent going deep instead of stopping at the first result.
4. **Live card** - an MCP Apps UI card in the chat. While the hunt runs: progress (5 of 8), one row per checklist item (done / checking / next / skipped / gap), best so far, buttons "Stop here" and "Skip a place" which the agent sees on its next step. When done: result card with price breakdown, "you pay today" vs "back later" kept apart, proof link per line, "Open ready link" (clean shop link) and "Watch for £X".
5. **Memory and watching** - what the person has (student, cards, memberships), saved items; daily rechecks of found links, email when it gets better. Agents forget between apps and cannot act in the background.

## Example hunt

"Any deals on these?" + Nike product link, budget £60. She is a UK student, has a Visa debit, is a Nike member.
Checklist: shop price, other sellers (4), student schemes, her memberships, codes, cashback sites, price match, card perks.
Result: £70 online, student 10% (online only, verify first) -£7, member free delivery, pay today £63; back later cashback £1.90 (separate). Still £3 over budget, stated.

## Hard rules (must be enforced by tools, not only playbooks)

- No find without a source link and observed time.
- No final result until every checklist row is done, skipped by the person, or named as a gap.
- Pay-today and back-later are never added together. Budget fit uses pay-today only.
- Every offer carries a status: confirmed / needs a step (verify, join, enrol) / untested (e.g. code from a code site) / unknown. Unconfirmed items never enter the guaranteed total.
- Codes from the seller's own site are trusted; codes from code sites are "untested".
- Unknown is an answer. No proof, no price.
- Scoat holds no money and never pays. The person pays via the ready link.

## Constraints

- No partner access: no bank, Visa, or retailer internal systems. Only public data, and our curated facts.
- Hosts differ: ChatGPT can pass files to tools; Claude chat may not; some hosts cannot render MCP Apps (need a text fallback for every card). Claude Code / Codex can fan out subagents over checklist rows; chat hosts go row by row.
- The live card is an iframe app that can call Scoat server tools via the host bridge (poll hunt state every few seconds) and send user actions (stop, skip).
- Two actors write to a hunt: the agent (logs finds) and the person via the card (stop/skip). Possibly several subagents log finds concurrently.
- Person identity via MCP OAuth (one Scoat account per person, works across hosts). Data is the person's, deletable.
- Keep the tool surface small: an agent reads every tool description each turn (target under ~8k tokens total).
- No monetization in v1. Ready links are clean shop links and never overwrite cashback tracking.
- Market: UK first, Gen Z / students.

## Out of scope for v1

Paying for the person, bank card-linked offers, branch shelf prices, verifying student status on Scoat's side, savings reconciliation.
