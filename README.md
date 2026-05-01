<!-- markdownlint-disable MD014 -->
<!-- markdownlint-disable MD033 -->
<!-- markdownlint-disable MD041 -->
<!-- markdownlint-disable MD029 -->

<div align="center">

<h1 style="font-size: 4.25rem; font-weight: 800; line-height: 1; margin: 0;">Agency Dashboard Template</h1>

<img src="ui/src/assets/under-construction.gif" alt="Under construction" width="380" />

</div>

A customizable dashboard template for on-chain agencies — DAO-shaped entities sourcing contributors, allocating treasury to projects, and billing against allocations.

Maintained by [MultiAgency](https://github.com/MultiAgency). Built on [everything.dev](https://github.com/NEARBuilders/everything-dev).

A [Module Federation](https://module-federation.io/) site composed at runtime, using the [`every-plugin`](https://plugin.everything.dev/) architecture and the [**everything-dev**](https://github.com/NEARBuilders/everything-dev/blob/main/packages/everything-dev/README.md) api & cli, with [NEAR Protocol](https://near.dev/) integration.

Built with [Tanstack Start](https://tanstack.com/start/latest/docs/framework/react/quick-start), [Hono.js](https://hono.dev/), [oRPC](https://orpc.dev/), [better-auth](https://better-auth.com/), and [rsbuild](https://rsbuild.rs/).

## Status

This fork is being shaped into the template described above. Today, the codebase is substantially the upstream everything.dev runtime with a few agency-shaped tweaks. The agency-specific modules listed under Planned do not yet exist.

**Template-committed (kept and shaped per the template):**
- Authentication (login)
- Home
- Settings

**Inherited from upstream — included as scaffolding; safe to delete day one if not needed for your agency:**
- Organizations — upstream `better-auth` org-scoped concept; conflicts with the planned Sputnik-DAO-membership gating
- Admin dashboard — opencode console; depends on the `opencode` plugin that isn't present in this repo
- Apps browser — everything.dev apps registry, not agency-specific

**Planned (not yet built):**
- Projects
- Contributors
- Treasury
- Billings
- Applications

Fork this repo, remove or extend any of the modules above, and customize per agency. When you deploy your fork, also rewrite [`ui/public/README.md`](./ui/public/README.md) and [`ui/public/skill.md`](./ui/public/skill.md) — those describe the maintainer's reference deployment and ship as-is to the deployed site.

## Quick Start

```bash
bun install             # Install dependencies
bos dev --host remote   # Start development (typical workflow)
```

This will start serving the UI, the API, and mounting it on a universally shared (remote) HOST application's build.

- UI: http://localhost:3002
- API: http://localhost:3014

This maintains a flexible, well-typed architecture that connects the entirity of the application, it's operating system, and a cli to interact with it. It is a perpetually in-development model for the [Blockchain Operating System (BOS)](https://near.social/#/)

## CLI Commands

`everything-dev` is the canonical runtime package and CLI. `bos` is a command alias for the same tool. See [.opencode/skills/everything-dev/SKILL.md](.opencode/skills/everything-dev/SKILL.md) for the full reference.

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
bos publish             # Publish config to the temporary dev.everything.near registry
bos publish --deploy    # Build/deploy all workspaces, then publish
bun run publish         # Same publish command via root script
bos sync                # Sync from production (every.near/everything.dev)
```

### Project Management

```bash
bos create project <name>   # Scaffold new project
bos info                    # Show configuration
bos status                  # Check remote health
bos clean                   # Clean build artifacts
```

## Development Workflow

### Making Changes

- **UI Changes**: Edit `ui/src/` → hot reload automatically → publish with `bos publish --deploy`
- **API Changes**: Edit `api/src/` → hot reload automatically → publish with `bos publish --deploy`
- **Host Changes**: Edit `host/src/` or `bos.config.json` → publish with `bos publish --deploy`

### Before Committing

Always run these commands before committing:

```bash
bun test        # Run all tests
bun typecheck   # Type check all packages
bun lint        # Run linting (see lint setup below)
```

### Changesets

We use [Changesets](https://github.com/changesets/changesets) for versioning:

**When to add a changeset:**
- Any user-facing change (features, fixes, deprecations)
- Breaking changes
- Skip for: docs-only changes, internal refactors, test-only changes

**Create a changeset:**
```bash
bun run changeset
# Follow prompts to select packages and describe changes
```

The release workflow (`.github/workflows/release.yml`) handles versioning and GitHub releases automatically on merge to main.

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

**Module Federation monorepo** with runtime-loaded configuration:

```
┌─────────────────────────────────────────────────────────┐
│                  host (Server)                          │
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
- ✅ **Independent Deployment** - UI, API, and Host deploy separately
- ✅ **Type Safety** - End-to-end with oRPC contracts
- ✅ **UI Runtime Boundary** - `everything-dev/ui/client` and `/server` own router/runtime glue
- ✅ **CDN-Ready** - Module Federation with [Zephyr Cloud](https://zephyr-cloud.io/)

## Configuration

All runtime configuration lives in `bos.config.json`. The shape used by this repo:

```json
{
  "account": "dev.everything.near",
  "domain": "agency",
  "repository": "https://github.com/nearbuilders/everything-dev",
  "staging": {
    "domain": "staging.dev.everything.dev"
  },
  "plugins": {
    "template": {
      "development": "local:plugins/_template"
    },
    "registry": {
      "development": "local:plugins/registry",
      "variables": {
        "registryNamespace": "dev.everything.near"
      }
    }
  },
  "app": {
    "host": { "name": "host", "development": "local:host" },
    "ui": { "name": "ui", "development": "local:ui" },
    "api": { "name": "api", "development": "local:api", "secrets": [] }
  },
  "testnet": "dev.allthethings.testnet",
  "shared": { "ui": {} },
  "extends": "bos://dev.everything.near/everything.dev"
}
```

The full `bos.config.json` also stages plugin entries for `projects` and `opencode`, which are placeholders for surfaces under development — those plugin directories are not yet present in the repo, and the entries above are the resolvable subset.

The temporary publish registry currently points at `dev.everything.near`, and `bos publish --deploy` is the release path when you want Zephyr URLs refreshed first.

### Railway

Use the repo `Dockerfile` for the service, and treat the GHCR image as the deployable artifact.

- Image source: `ghcr.io/<lowercased github.repository>:latest`
- Staging: `ghcr.io/<lowercased github.repository>:staging`
- Preview: `ghcr.io/<lowercased github.repository>:pr-<number>`

All configuration derives from `bos.config.json` (baked into the image). Only secrets need to be set as environment variables.

Required runtime vars:
- `APP_ENV` - `production` or `staging` (derives domain from `bos.config.json`)
- `BETTER_AUTH_SECRET` - Session encryption key
- `BETTER_AUTH_URL` - Auth callback URL (defaults to host URL from config)
- `HOST_DATABASE_URL` - Database connection string
- `HOST_DATABASE_AUTH_TOKEN` - Database auth token
- `CORS_ORIGIN` - Comma-separated allowed origins (defaults to host + UI URLs from config)

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
