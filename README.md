<!-- markdownlint-disable MD014 -->
<!-- markdownlint-disable MD033 -->
<!-- markdownlint-disable MD041 -->
<!-- markdownlint-disable MD029 -->

<div align="center">

<h1 style="font-size: 4.25rem; font-weight: 800; line-height: 1; margin: 0;">multiagency.ai</h1>

</div>

The dashboard for multiagency.ai — an on-chain agency: a DAO-shaped entity sourcing contributors, budgeting treasury to projects, and billing against those budgets.

Maintained by [MultiAgency](https://github.com/MultiAgency). Built on [everything.dev](https://github.com/NEARBuilders/everything-dev).

A [Module Federation](https://module-federation.io/) site composed at runtime, using the [`every-plugin`](https://plugin.everything.dev/) architecture and the [**everything-dev**](https://github.com/NEARBuilders/everything-dev/blob/main/packages/everything-dev/README.md) api & cli, with [NEAR Protocol](https://near.dev/) integration.

Built with [Tanstack Start](https://tanstack.com/start/latest/docs/framework/react/quick-start), [Hono.js](https://hono.dev/), [oRPC](https://orpc.dev/), [better-auth](https://better-auth.com/), and [rsbuild](https://rsbuild.rs/).

## Application

The app is split into four auth-gated sections plus public pages:

- **Public** (`/`) — Landing, projects directory, apply forms, contact, docs, treasury, team, work
- **`/platform`** — Super admin only (`user.role === "admin"`). App owner dashboard for creating and managing all organizations. Init the agency org here on first deploy.
- **`/admin`** — Agency admin & owner (Better Auth org role `admin` or `owner`). Manage agency settings (`/admin/settings`), members (`/admin/members`), and projects (`/admin/projects/:slug`).
- **`/dashboard`** — Agency members, admins, and owners (org role `member`, `admin`, or `owner`).
- **`/client`** — Any authenticated user. Client portal for organizations with metadata `type: "client"`.

API routes are gated server-side with Better Auth organization roles:
- **Read-only** (list projects, contributors, budgets, etc.): `admin`, `owner`, `member`
- **Write & financial** (create/delete, budget transfers, billing): `admin`, `owner`
- **Platform** (org creation, global listing): `user.role === "admin"` super admin only

On-chain treasury operations (proposals, token balances, FT holdings) integrate with Sputnik DAO contracts when the org's metadata includes a `daoAccountId`. Non-DAO orgs treat the org account as self-owned.

## First-time setup

Deploy the app, then make yourself a super admin to set up the initial agency.

1. Sign in with your NEAR wallet at the deployed URL.
2. Open the auth database and set your user role to `admin`:
   ```bash
   bun bos db studio auth
   ```
   In the Drizzle Studio UI, navigate to the `user` table and set the `role` column to `admin` for your user row.
3. Visit `/platform` and create your agency organization (`type: "agency"`) with an optional `daoAccountId` if you have a Sputnik DAO.
4. Invite agency admins and members from `/admin/members`.

## Quick Start

```bash
bun install             # Install dependencies
bun run dev:postgres    # Boot docker compose Postgres + start dev (persistent local dev)
# or:
bun run db:migrate && bun run dev   # Use the configured API_DATABASE_URL, or in-memory pglite by default
```

The API plugin uses PostgreSQL via Drizzle. Without `API_DATABASE_URL` set, it boots against an in-memory `pglite` database — fine for quick exploration but state resets on every restart. For persistent local dev, `bun run dev:postgres` boots PostgreSQL instances via `docker-compose.yml` (api/auth/builders/projects on 5432/5433/5434/5435) and starts the dev server. Migrations run automatically on startup; `bun run db:migrate` applies them manually against the configured database.

To inspect databases locally:
```bash
bos db studio api       # API database (agency schema)
bos db studio auth      # Auth database (users, sessions, organizations)
bos db studio projects  # Projects plugin database
bos db studio <plugin>  # Any registered plugin database
```

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

All runtime configuration lives in [`bos.config.json`](./bos.config.json). The agency surface lives in `api/`, which proxies the upstream `projects` plugin via `pluginsClient.projects(proxyCtx(orgAccountId))` for project CRUD (list/get/create/update). See [AGENTS.md](./AGENTS.md) for the plugin model and proxy-as-org rule.

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

- **[everything.dev](https://github.com/NEARBuilders/everything-dev)** - Upstream foundation and runtime
- **[every-plugin](https://github.com/near-everything/every-plugin)** - Plugin framework for modular APIs
- **[near-kit](https://kit.near.tools)** - Unified NEAR Protocol SDK
- **[better-near-auth](https://github.com/elliotBraem/better-near-auth)** - NEAR authentication for Better-Auth

## License

MIT
