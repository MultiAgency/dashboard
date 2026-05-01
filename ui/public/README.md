# Agency Dashboard

This is MultiAgency's reference deployment of the [Agency Dashboard Template](https://github.com/MultiAgency/dashboard) — a runtime-composed site for on-chain agencies on NEAR, built on the everything.dev runtime.

The bootstrap root is published from `dev.everything.near/everything.dev` and composed at runtime from public configuration rather than a single fixed bundle.

## What it is

- A dashboard surface for an on-chain agency, deployed as the reference instance of the template
- A product surface built from a host, remote UI, and remote API — composed at runtime
- A downstream runtime built on top of `everything.dev`

## How it works

1. A published `bos.config.json` record defines the runtime.
2. The bootstrap root is published first, without `extends`.
3. Other configs can extend that root record once it exists.
3. The UI loads through Module Federation.
4. The API loads through `every-plugin`.
5. Public metadata can be layered on without replacing the canonical runtime record.

## Why it matters

- Runtime configuration stays public and inspectable.
- Sites can share the same host while changing composition through config.
- UI and API can evolve independently.
- The system can keep being built over time because composition is externalized.

## Public files

- `/README.md` - human-readable overview
- `/skill.md` - agent-oriented usage notes
- `/llms.txt` - concise machine-ingestible summary
- `/manifest.json` - install and browser metadata

## Related ideas

- BOS
- Web4
- NEAR Intents
- Near DNS
- `every-plugin`

## Canonical context

- Bootstrap runtime: `dev.everything.near/everything.dev`
- This site extends `bos://dev.everything.near/everything.dev` via `bos.config.json`
- Stable host URLs can be reused across multiple sites
- Composition happens through published config, not rebuild-only deployment
