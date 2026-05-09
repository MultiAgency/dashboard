<!-- markdownlint-disable MD014 -->
<!-- markdownlint-disable MD033 -->
<!-- markdownlint-disable MD041 -->
<!-- markdownlint-disable MD029 -->

<div align="center">

<h1 style="font-size: 4.25rem; font-weight: 800; line-height: 1; margin: 0;">Agency Dashboard Template</h1>

</div>

A customizable dashboard template for on-chain agencies — DAO-shaped entities sourcing contributors, allocating treasury to projects, and billing against allocations.

Maintained by [MultiAgency](https://github.com/MultiAgency). Built on [everything.dev](https://github.com/NEARBuilders/everything-dev).

A [Module Federation](https://module-federation.io/) site composed at runtime, using the [`every-plugin`](https://plugin.everything.dev/) architecture and the [**everything-dev**](https://github.com/NEARBuilders/everything-dev/blob/main/packages/everything-dev/README.md) api & cli, with [NEAR Protocol](https://near.dev/) integration.

Built with [Tanstack Start](https://tanstack.com/start/latest/docs/framework/react/quick-start), [Hono.js](https://hono.dev/), [oRPC](https://orpc.dev/), [better-auth](https://better-auth.com/), and [rsbuild](https://rsbuild.rs/).

## Status

This fork is shaped as the template described above. Phase 0 cleanup removed the upstream surfaces that don't fit the agency model (organizations, admin dashboard, apps browser, registry plugin). The agency-specific modules below are wired end-to-end in this commit.

**Public surface:**

- Landing — operating model + docs links + CTAs
- Projects directory (title + status + slug per row; full project listings live on NEARN, not this dashboard)
- Express interest form (replicate / contributor)
- Connect (NEAR sign-in via `better-near-auth` SIWN — only auth method)

**Authenticated workspace:**

- Home
- Settings — identity + agency configuration (DAO account, NEARN account, name, website, description, metadata) for admins
- Admin / Projects — list, create, edit, assign contributors
- Admin / Contributors — list, create, edit (compliance status + docs)
- Admin / Allocations — per-project budget rollup, allocate/deallocate, audit log
- Admin / Billings — flat list with project / contributor filters; create new billings as project-scoped pointers to Sputnik DAO proposals (`proposalId` required, `NOT NULL UNIQUE`). Status is read live from chain per-request (seven-state Sputnik enum); no local lifecycle field, no manual status override. Per-row Trezu deep-link for the live chain view.
- Admin / Applications — flat list with kind / status filters; review submissions from `/apply`, transition status (new → reviewing → accepted/declined). Submissions themselves are immutable

Admin routes are gated server-side by a `gates` registry that checks Sputnik DAO role membership (strict `Admin` / `Approver` / `Requestor` tiers plus named compositions like `operator` for Admin OR Approver) for the signed-in NEAR account against `agency_settings.daoAccountId`. Time-series admin lists (billings, allocations, applications) are paginated cursor-style; the UI exposes a "load more" button.

Fork this repo, remove or extend any of the modules above, and customize per agency. When you deploy your fork, rewrite [`ui/public/README.md`](./ui/public/README.md), [`ui/public/skill.md`](./ui/public/skill.md), and [`ui/public/manifest.json`](./ui/public/manifest.json) — those carry the maintainer's identity and ship as-is to the deployed site (manifest.json drives the install-prompt + browser-tab name).

## First-time setup (forks)

Every agency points this dashboard at its own Sputnik DAO. There are two paths — pick whichever fits your deployment workflow:

**Prerequisites**: NEAR account, Sputnik DAO contract on NEAR, Admin role in that DAO.

**Path A — set the env var before deploying (recommended):**

```bash
export AGENCY_DAO_ACCOUNT=your-dao.sputnik-dao.near
bun install
bun run db:migrate
bos dev --host remote
```

The plugin's `initialize` seeds `agency_settings.daoAccountId` from the env var the next time the process starts against an empty row. Admin gates work immediately. Use this path when you control your deployment environment.

**Path B — claim through the UI after deploy (fallback):**

Deploy without setting the env var. Sign in with NEAR; `/home` renders a "Set up your agency" affordance. Submit your DAO account ID (and admin role name if your DAO uses something other than `Admin`, e.g. raw Sputnik's `council`). The handler verifies you're admin on the destination DAO before writing the row. Useful for PaaS hosts where env injection happens after deploy.

**Verification:** after either path, `/settings` shows your DAO account id and the admin nav appears. If admin endpoints return FORBIDDEN, the dashboard is still pointed at the placeholder DAO — re-run with the env var set, or use the claim flow.

## Quick Start

```bash
bun install             # Install dependencies
bun run db:migrate      # Apply API schema to ./api.db (one-time per fresh checkout)
bos dev --host remote   # Start development (typical workflow)
```

The agency API plugin owns its own libsql database at `./api.db` and ships its
own migrations in `api/src/db/migrations/`. `bun run db:migrate` applies them;
the API plugin's `initialize` then upserts default rows (e.g. `agency_settings`)
against the now-migrated schema. Skipping this step before `bos dev` causes
`SQLITE_ERROR: no such table: ...` at API startup.

This serves the UI and API locally and mounts them on a remote host (loaded via `bos.config.json`'s `extends`).

- UI: http://localhost:3002
- API: dynamic port (check the `[API ✓ ready]` line in the dev server output)

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
  "account": "agency.near",
  "extends": "bos://dev.everything.near/everything.dev",
  "domain": "multiagency.ai",
  "testnet": "agency.testnet",
  "staging": { "domain": "dev.multiagency.ai" },
  "repository": "https://github.com/MultiAgency/dashboard",
  "plugins": {},
  "app": {
    "host": { "development": "local:host" },
    "ui": { "name": "ui", "development": "local:ui" },
    "api": { "name": "api", "development": "local:api", "secrets": [] }
  }
}
```

No plugins currently registered; the agency surface lives in `api/`. See `AGENTS.md` for the forward-looking plugin model.

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

- SQLite (libsql) + Drizzle ORM
- Better-Auth with NEAR Protocol support

## Related Projects

- **[everything.dev](https://github.com/NEARBuilders/everything-dev)** - Upstream foundation: the runtime this template is built on
- **[every-plugin](https://github.com/near-everything/every-plugin)** - Plugin framework for modular APIs
- **[near-kit](https://kit.near.tools)** - Unified NEAR Protocol SDK
- **[better-near-auth](https://github.com/elliotBraem/better-near-auth)** - NEAR authentication for Better-Auth

## License

MIT
