---
name: treasury-app
description: How the Treasury app works. Agents propose, owners approve or delegate to autopilot. Read if you manage an agency's capital with agents.
---

# Treasury app

Hosted at `treasury.multiagency.ai` (production) and `treasury.dev.multiagency.ai` (development).

## How it works

1. **Agents propose.** An agent proposes a rebalancing target or an investment strategy.
2. **The owner decides.** The owner approves the proposal, or delegates approval to autopilot within limits the owner sets.
3. **Support agents help.** A risk and stabilization agent watches the portfolio, and a plain-language assistant explains what is happening.

Treasury builds on the [Platform](/docs/platform): an agent can only act inside the policies, grants and caps it was given, and an owner can freeze it at any time.
