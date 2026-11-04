# Brainstorm log

How Scoat got to its current shape, in order. Dates are 2026-11-04.

## Where it started

The Visa design project's use case 3, "Best Price In Store": a student at a Nike store snaps shoes tagged £70 with a £60 budget, and an AI finds every way to close the gap. Scoat began as a headless MCP for Claude and Codex that could deliver flows like that.

## How the idea changed

| Step | Shape | Why it moved on |
|---|---|---|
| v0.1 | Headless MCP with checkout, wallet, savings ledger | Too much: payments and stored wallets are not what agents need from us. |
| v0.2 | Search and vision toolbox: read image, identify, prices, offers, compare | Codex review found the logic proved a possible £60, not a verified one. |
| v0.3 | Built only from public data | We have no bank, Visa or retailer access. Card-linked offers, shelf prices and eligibility checks need partners, so they wait. |
| v0.4 | The agent searches, Scoat checks and shows | Claude and ChatGPT already search and see well. Do not rebuild that. |
| v0.5 | If the agent can do it, the agent does it | Scoat only brings what agents lack. |
| v0.6 | Hunting kit: teach the agent to hunt and keep it hunting | Agents search once, stop early and forget. |
| v0.7 | Find the best benefit from what she asks, with a live card | She must see the hunt while it runs. |
| v0.8 | Four tools, one hunt | Locked by an architecture arena of three Codex designs and a Codex judge. |

## What Scoat is now

A kit for Claude and ChatGPT that finds the best benefit (price, student discount, member perks, cashback, points, card perks) from what she asks.

- Playbooks teach the agent where benefits hide, in what order, and how to prove each.
- Benefit facts are curated per shop: student scheme, online or in store, what stacks, price match, cashback sites.
- The hunt tracker keeps a checklist and says what is left, across chats and hosts.
- The live card shows the hunt as it runs, then the result with proof and a ready link.
- Memory and watching keep her profile and saved items, recheck daily and email her.

## Reviews that shaped it

Three Codex reviewers checked v0.2.

- **Logic:** store and branch were assumed, eligibility came after search, self-declared student status was treated as redeemable, no redemption step, no rules for stacking, pay now and back later were mixed, no failure paths.
- **Technical reality:** ChatGPT can pass a chat photo to a tool; Claude chat does not document this. Nike UK's student discount is 10%, online only, needs verification and membership, so £70 becomes £63 online, not £60 in store. Card-linked offers need enrolment. Nearby shelf prices need retailer feeds.
- **Market reality:** photo to cheaper price is already done by Google Lens, ChatGPT shopping, Klarna and shopping MCPs. The open gap is reliable, personalised eligibility and redemption.

Every finding is answered in the current design: context is asked first, offers carry a status, pay today and back later never add up, unknown is an answer, and the Nike example tells the truth.

## Decisions

- No model inside Scoat. The host's model reasons.
- No partner access in v1. Public data and our curated facts only.
- No monetization in v1. Ready links are clean shop links and never overwrite her cashback tracking.
- UK first, students and first jobbers.
- A completely new repo, designed from this discussion, not from any earlier Scoat code.
- No comments in code. Names and tests carry the meaning; `npm run lint:comments` enforces it.
- The real test: on 50 real carts, the agent with Scoat must find more real savings than the plain agent, with no fake codes. Build on only if Scoat wins.

## Architecture arena

`arch/` holds the spec all runners worked from (`grounding.md`) and the three candidates:

- candidate-1, append-only event log (gpt-6.1-sol)
- candidate-2, playbook as a typed program (gpt-6-astra)
- candidate-3, agent-led with the server as referee (gpt-6.1-terra)

Base: candidate 3, for row-level transactions a small team can build. Grafted from 1: the small tool surface, money types and one view for card and text. Grafted from 2: evidence checks and distinct-seller coverage. Details in `RATIONALE.md`.
