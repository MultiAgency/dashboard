---
name: publish-sync
description: Publish bos.config.json to the FastKV registry, sync from upstream, and upgrade workspace packages. Use when deploying, syncing, or managing runtime configuration across projects.
metadata:
  sources: "src/plugin.ts,src/cli/sync.ts,src/cli/upgrade.ts,src/fastkv.ts,src/integrity.ts"
---

# everything-dev Publish & Sync

## Core Workflow

```
Build → Deploy → Publish → Sync
  ↓       ↓        ↓        ↓
rspack  Zephyr   FastKV   bos sync
        CDN      registry
```

## Publish

Publish `bos.config.json` to the temporary `dev.everything.near` FastKV registry:

```bash
bos publish                  # Publish config only
bos publish --deploy         # Build/deploy all workspaces first, then publish
bos publish --dry-run        # Preview without sending
bos publish --network testnet
bos publish --packages ui,api
```

After `bos publish --deploy`:
1. Each workspace builds and deploys to Zephyr CDN
2. `bos.config.json` is auto-updated with production URLs + integrity hashes
3. Config is published to the FastKV registry at `{account}/bos/gateways/{gateway}/bos.config.json`

## Sync

Pull updates from a published config:

```bash
bos sync                                    # From every.near/everything.dev (default)
bos sync --account foo.near --gateway bar.com
bos sync --network testnet
bos sync --force
bos sync --files                            # Also sync template files (rsbuild.config.ts, etc.)
```

What gets synced from remote:
- `app.*.production` — Zephyr URLs
- `app.*.ssr` — SSR URLs
- `app.*.template`, `app.*.files`, `app.*.sync` — scaffolding config
- `shared` — shared dependency versions
- `gateway` — gateway URLs

What stays local:
- `account`, `testnet` — your NEAR accounts
- `app.*.development` — local dev URLs

What gets merged:
- `app.*.secrets` — union of remote + local
- `app.*.variables` — merged (local overrides remote)

## Upgrade

Bump `every-plugin` and `everything-dev` across all workspaces:

```bash
bos upgrade              # Check for new versions, update, then sync
bos upgrade --dry-run    # Preview without making changes
```

`bos upgrade` updates **all workspace `package.json`s**, not just root. Also updates `peerDependencies` and `workspaces.catalog`. Correctly skips `workspace:*` and `catalog:` references.

## Build

```bash
bos build                # Build all packages (skips missing)
bos build ui             # Build specific package
bos build ui,api         # Build multiple
bos build --force        # Force rebuild
```

## Config Integrity

`bos.config.json` entries can include `integrity` fields with SRI hashes:

```json
{
  "app": {
    "ui": {
      "production": "https://cdn.example.com/ui/remoteEntry.js",
      "integrity": "sha384-abc123..."
    }
  }
}
```

These are auto-generated during `bos publish --deploy` and verified at runtime by the host.

## Project Creation

```bash
bos create project my-app                           # Interactive
bos create project my-app -a my.near --testnet my.testnet  # Skip prompts
```

## Configuration

All runtime config lives in `bos.config.json`. Key sections:
- `account` — NEAR mainnet account
- `testnet` — NEAR testnet account
- `staging.domain` — Staging domain
- `app.host`, `app.ui`, `app.api`, `app.auth` — Module configs with development/production URLs
- `plugins.{key}` — Plugin configs with variables, secrets, routes
- `shared.ui`, `shared.api` — Module Federation shared dependency versions

## Troubleshooting

```bash
bos info              # Show current configuration
bos status             # Check remote health
bos clean              # Clean build artifacts
```

Process issues:
```bash
bos kill               # Kill all tracked processes
bun install            # Reinstall deps
bos dev --host remote  # Restart
```
