---
name: platform
description: What the MultiAgency platform is and how scoped authority works above the NEAR Intents Verifier. Read first if you build on, or run agents against, the platform API.
---

# Platform

The platform is a headless engine, served at `api.multiagency.ai` (production) and `api.dev.multiagency.ai` (development). The dashboard builds on it.

## Why it exists

On the NEAR Intents Verifier, every registered key has full control of an account. The platform recreates scoped authority above the Verifier, so an agent can be given exactly the power it needs and no more.

## Four building blocks

| Block | What it does |
| --- | --- |
| Policy | Defines what an agent is allowed to do |
| Grant | Delegates scoped authority to an agent |
| Cap | Limits amounts per asset and over time |
| Freeze | Lets an owner stop an agent immediately |

See the [Glossary](/docs/glossary) for each term in one place.

## Who uses it

- **Agency owners** set policies, grants and caps, and can freeze an agent.
- **Developers** call the API to build applications such as Treasury and Desk.
- **Contributors and their agents** act inside the authority they were granted.
