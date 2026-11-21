---
name: extents
description: What NEAR Extents (working title) is. Companion contracts to the NEAR Intents Verifier for shared objectives across several parties. Planned.
---

# NEAR Extents (working title)

Status: planned. The objective contract is built and unit-tested; end-to-end testing is under way.

The Verifier settles economic intents: transfers, withdrawals and swaps. Extents extends this to social outcomes that need commitments from several parties, for example "I have USDC on NEAR, I want an event organized in NYC."

- Each objective is its own contract at a predictable address, holds funds as balances on the Verifier, and settles through standard transfers.
- A DAO funds the objective. Contributors commit on-chain. The evaluator attests with a hash of its written review. Payment releases only on an achieved verdict, otherwise the funds return to the funder.
- Work can be split into milestones, each its own objective, so risk is spread over time and contributors are paid sooner.

See the [Glossary](/docs/glossary) for the terms.
