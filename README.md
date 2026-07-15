<!-- markdownlint-disable MD014 -->
<!-- markdownlint-disable MD033 -->
<!-- markdownlint-disable MD041 -->
<!-- markdownlint-disable MD029 -->

<div align="center">

<h1 style="font-size: 4.25rem; font-weight: 800; line-height: 1; margin: 0;">Agency Dashboard Template</h1>

</div>

A customizable dashboard template for on-chain agencies — DAO-shaped entities sourcing contributors, budgeting treasury to projects, and billing against those budgets.

Maintained by [MultiAgency](https://github.com/MultiAgency). Built on [everything.dev](https://github.com/NEARBuilders/everything-dev).

A [Module Federation](https://module-federation.io/) site composed at runtime, using the [`every-plugin`](https://plugin.everything.dev/) architecture and the [**everything-dev**](https://github.com/NEARBuilders/everything-dev/blob/main/packages/everything-dev/README.md) api & cli, with [NEAR Protocol](https://near.dev/) integration.

Built with [Tanstack Start](https://tanstack.com/start/latest/docs/framework/react/quick-start), [Hono.js](https://hono.dev/), [oRPC](https://orpc.dev/), [better-auth](https://better-auth.com/), and [rsbuild](https://rsbuild.rs/).

## Status

[![CI](https://github.com/NEARBuilders/multiagency.ai/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/NEARBuilders/multiagency.ai/actions/workflows/ci.yml)

This repo is shaped as the template described above. Phase 0 cleanup removed the upstream surfaces that don't fit the agency model (generic org CRUD UI, admin dashboard, apps browser, registry plugin). The agency-specific modules below are wired end-to-end in this commit.

**Public surface:**

- Landing — operating model + docs links + CTAs
- Projects directory (title + status + slug per row; full project listings live on NEARN, not this dashboard)
- Express interest forms (founder / contributor / client)
- Connect (NEAR sign-in via `better-near-auth` SIWN — only auth method)

**Authenticated workspace:**

- Home
- Admin / Projects — list, create, edit, assign contributors
- Admin / Contributors — list, create, edit (compliance status + docs)
- Admin / Budgets — per-project rollup (budgeted / allocated / committed / paid / remaining) with budget / deallocate / transfer actions, audit log
- Admin / Billings — flat list with project / contributor filters; create new billings as project-scoped pointers to Sputnik DAO proposals (`proposalId` required, `NOT NULL UNIQUE`). Status is read live from chain per-request (seven-state Sputnik enum); no local lifecycle field, no manual status override. Per-row Trezu deep-link for the live chain view.
- Admin / Applications — flat list with kind / status filters; review submissions from `/apply`, transition status (new → reviewing → accepted/declined). Submissions themselves are immutable

Admin routes are gated server-side by a `gates` registry that checks Sputnik DAO role membership (strict `Admin` / `Approver` / `Requestor` tiers plus named compositions like `operator` for Admin OR Approver) for the signed-in NEAR account against the resolved `orgAccountId` (`getOrgAccountId(reqHeaders)` → `defaultOrgAccount(network)`, env-driven). Time-series admin lists (billings, budgets, applications) are paginated cursor-style; the UI exposes a "load more" button.

Instantiate a new agency via `bunx everything-dev init` (the canonical entry point — pulls the template, scaffolds a fresh repo and DB). Remove or extend any of the modules above, and customize per agency. Before deploying, rewrite [`ui/public/README.md`](./ui/public/README.md), [`ui/public/skill.md`](./ui/public/skill.md), and [`ui/public/manifest.json`](./ui/public/manifest.json) — those carry the maintainer's identity and ship as-is to the deployed site (manifest.json drives the install-prompt + browser-tab name).

## First-time setup

A fresh deployment points at the maintainer's DAO (`multiagency.sputnik-dao.near`) and renders live data immediately. To take over a fresh deployment as your own agency, point it at your DAO.

**Prerequisites**: NEAR account, Sputnik DAO contract on NEAR, Admin role in that DAO.

**Either** override the per-network default before deploying:

```bash
export AGENCY_ORG_ACCOUNT_MAINNET=your-dao.sputnik-dao.near
bun install
bun run db:migrate
bos dev --host remote
```

Admin nav appears once you sign in with a NEAR account that holds the `Admin` role on the configured DAO. If admin endpoints return FORBIDDEN, the dashboard is still pointed at a DAO you don't admin — update the env var and restart.

**Pointing at a testnet DAO.** The network is derived from the account's TLD — a `.sputnikv2.testnet` suffix routes Sputnik RPC to a testnet endpoint automatically. Set `NEAR_NETWORK=testnet` to switch the no-row fallback to `AGENCY_ORG_ACCOUNT_TESTNET` (default `multiagency.sputnikv2.testnet`):

```bash
export NEAR_NETWORK=testnet
export AGENCY_ORG_ACCOUNT_TESTNET=your-dao.sputnikv2.testnet
```

Override the RPC endpoint per network with `NEAR_RPC_URL_MAINNET=...` / `NEAR_RPC_URL_TESTNET=...` if you run a private RPC; otherwise the public fastnear endpoints route correctly per-account. `NEARN` integrations gracefully short-circuit on testnet (no testnet endpoints). Trezu deep-links use the mainnet URL pattern and may dead-link until Trezu publishes a testnet routing scheme. To stand up a testnet Sputnik DAO, use the `sputnikv2.testnet` factory's `create` method via `near-cli` or `near-cli-rs` with a policy mirroring mainnet's role shape — see the [Sputnik DAO contract README](https://github.com/near-daos/sputnik-dao-contract) for ABI reference.

## Quick Start

```bash
bun install             # Install dependencies
bun run dev:postgres    # Boot docker compose Postgres + start dev (persistent local dev)
# or:
bun run db:migrate && bun run dev   # Use the configured API_DATABASE_URL, or in-memory pglite by default
```

The API plugin uses PostgreSQL via Drizzle. Without `API_DATABASE_URL` set, it boots against an in-memory `pglite` database — fine for quick exploration but state resets on every restart. For persistent local dev, `bun run dev:postgres` boots three Postgres instances via `docker-compose.yml` (api/auth/projects on 5432/5433/5434) and starts the dev server. Migrations live in `api/src/db/migrations/`; `bun run db:migrate` applies them against the configured database. Operational identity reads the `agency.settings` row (keyed by `orgAccountId`) when present, else falls through to env (`AGENCY_*` / `AGENCY_ORG_ACCOUNT_*`) and hardcoded defaults — a fresh database renders correctly with no manual seed.

This serves the UI and API locally and mounts them on a remote host (loaded via `bos.config.json`'s `extends`). See [AGENTS.md](./AGENTS.md#environment) for the full port table. UI defaults to `http://localhost:3003` (rsbuild auto-bumps if occupied — check the dev server output).

## CLI Commands

`everything-dev` is the canonical runtime package and CLI. `bos` is a command alias for the same tool. See the framework skills at [.opencode/skills/everything-dev/](.opencode/skills/everything-dev/) — `dev-workflow/SKILL.md` for the dev cycle and `publish-sync/SKILL.md` for deployment, sync, and upgrade flows.

### Development

```bash
everything-dev dev --host remote   # Remote host, local UI + API (typical)
everything-dev dev --ui remote     # Isolate API work
everything-dev dev --api remote    # Isolate UI work
           |/ --proxy              # Use a proxy
everything-dev dev                 # Full local, client shell by default

# `bos` is an alias for the same commands
bos dev --ssr                      # Opt into local SSR
```

### Production

```bash
everything-dev start --no-interactive   # All remotes, production URLs
```

### Build & Publish

```bash
bos build               # Build all packages (updates bos.config.json)
bos publish             # Publish config to the FastKV registry under `account`
bos publish --deploy    # Build/deploy all workspaces, then publish
bun run publish         # Same publish command via root script
```

Production CI/CD is already wired:

1. **CI** (`.github/workflows/ci.yml`) — on every PR and push to `main`: install (Bun install cache), audit, lint, typecheck, test
2. **Deploy** (`.github/workflows/deploy.yml`) — after CI succeeds on `main`: `bos publish --deploy`, then `railway redeploy`

App env vars stay in the **Railway dashboard** (not committed). GitHub Actions needs these **repository secrets** for deploy to run unattended:

| Secret | Used by | Purpose |
|---|---|---|
| `RAILWAY_TOKEN` | Deploy | Production Railway redeploy (`railway redeploy --service app`) |
| `RAILWAY_STAGING_TOKEN` | Staging | Staging Railway redeploy (`.github/workflows/staging.yml`) |
| `ZEPHYR_AUTH_TOKEN` | Deploy / Staging | Zephyr CDN auth for `bos publish --deploy` (`ZE_SERVER_TOKEN`) |
| `ZEPHYR_USER_EMAIL` | Deploy / Staging | Zephyr user email (`ZE_USER_EMAIL`) |
| `NEAR_PRIVATE_KEY` | Deploy / Staging | NEAR key for FastKV / publish |

### Project Management

```bash
bos info                    # Show configuration
bos status                  # Check remote health
bos clean                   # Clean build artifacts
```

## Development Workflow

### Making Changes

- **UI Changes**: Edit `ui/src/` → hot reload automatically → publish with `bos publish --deploy`
- **API Changes**: Edit `api/src/` → hot reload automatically → publish with `bos publish --deploy`
- **Runtime Config**: Edit `bos.config.json` → publish with `bos publish --deploy` (the host is remote — see Architecture)

### Before Committing

Always run these commands before committing:

```bash
bun test        # Run all tests
bun typecheck   # Type check all packages
bun lint        # Run linting (see lint setup below)
```

### Git Workflow

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed contribution guidelines including:

- Branch naming conventions
- Semantic commit format
- Pull request process

## Documentation

- **[AGENTS.md](./AGENTS.md)** - Quick operational guide for AI agents
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** - Contribution guidelines and git workflow
- **[ui/public/README.md](./ui/public/README.md)** - Public-facing description of the maintainer's reference deployment
- **[ui/public/skill.md](./ui/public/skill.md)** - Agent-oriented usage notes for the deployed site

## Architecture

**Module Federation monorepo** with runtime-loaded configuration. The host is **remote** (loaded via `bos.config.json`'s `extends`); this repo owns `ui/` and `api/` only.

```
┌─────────────────────────────────────────────────────────┐
│              Host (Remote — not in this repo)           │
│  Hono.js + oRPC + bos.config.json loader                │
│  ┌──────────────────┐      ┌──────────────────┐         │
│  │ Module Federation│      │ every-plugin     │         │
│  │ Runtime          │      │ Runtime          │         │
│  └────────┬─────────┘      └────────┬─────────┘         │
│           ↓                         ↓                   │
│  Loads UI Runtime          Loads API Plugins            │
└───────────┬─────────────────────────┬───────────────────┘
            ↓                         ↓
┌───────────────────────┐ ┌───────────────────────┐
│    ui/ (Runtime)      │ │   api/ (Plugin)       │
│  React + TanStack     │ │  oRPC + Effect        │
│  ui/src/app.ts        │ │  remoteEntry.js       │
└───────────────────────┘ └───────────────────────┘
```

**Key Features:**

- ✅ **Runtime Configuration** - All URLs from `bos.config.json` (no rebuild needed)
- ✅ **Independent Deployment** - UI and API deploy separately
- ✅ **Type Safety** - End-to-end with oRPC contracts
- ✅ **UI Runtime Boundary** - `everything-dev/ui/client` and `/server` own router/runtime glue
- ✅ **CDN-Ready** - Module Federation with [Zephyr Cloud](https://zephyr-cloud.io/)

## Configuration

All runtime configuration lives in `bos.config.json`. The shape used by this repo:

```json
{
  "account": "multiagentic.near",
  "extends": "bos://dev.everything.near/everything.dev",
  "domain": "multiagency.ai",
  "testnet": "agency.testnet",
  "staging": { "domain": "dev.multiagency.ai" },
  "repository": "https://github.com/MultiAgency/dashboard",
  "plugins": { /* upstream projects plugin; see bos.config.json */ },
  "app": {
    "host": { "development": "local:host" },
    "ui": { "name": "ui", "development": "local:ui" },
    "api": { "name": "api", "development": "local:api", "secrets": [] }
  }
}
```

The agency surface lives in `api/`, which proxies the upstream `projects` plugin via `pluginsClient.projects(proxyCtx(orgAccountId))` for project CRUD (list/get/create/update). See `AGENTS.md` for the plugin model and proxy-as-org rule.

`bos publish --deploy` is the release path when you want Zephyr URLs refreshed before publishing the config.

## Lint Setup

This project uses [Biome](https://biomejs.dev/) for linting and formatting:

```bash
# Check linting
bun lint

# Fix auto-fixable issues
bun lint:fix

# Format code
bun format
```

Biome is configured in `biome.json` at the project root. Generated files (like `routeTree.gen.ts`) are automatically excluded.

## Tech Stack

**Frontend:**

- React 19 + TanStack Router (file-based) + TanStack Query
- Tailwind CSS v4 + shadcn/ui components
- Module Federation for microfrontend architecture

**Backend:**

- Hono.js server + oRPC (type-safe RPC + OpenAPI)
- [every-plugin](https://plugin.everything.dev/) architecture for modular APIs
- Effect-TS for service composition

**Database & Auth:**

- PostgreSQL + Drizzle ORM (`pglite` in-memory by default; `node-postgres` when `API_DATABASE_URL` is set)
- Better-Auth with NEAR Protocol support

## Related Projects

- **[everything.dev](https://github.com/NEARBuilders/everything-dev)** - Upstream foundation: the runtime this template is built on
- **[every-plugin](https://github.com/near-everything/every-plugin)** - Plugin framework for modular APIs
- **[near-kit](https://kit.near.tools)** - Unified NEAR Protocol SDK
- **[better-near-auth](https://github.com/elliotBraem/better-near-auth)** - NEAR authentication for Better-Auth

## License

MIT
