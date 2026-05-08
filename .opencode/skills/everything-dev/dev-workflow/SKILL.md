---
name: dev-workflow
description: Development workflow for everything-dev projects using bos dev, bos start, and the Module Federation runtime. Use when starting dev servers, debugging hot reload, or understanding the service-descriptor architecture.
metadata:
  sources: "src/service-descriptor.ts,src/orchestrator.ts,src/dev-logs.ts,src/host.ts"
---

# everything-dev Development Workflow

## Starting Development

```bash
# Typical: remote host, local UI + API
bos dev --host remote

# Isolate work
bos dev --api remote     # UI only
bos dev --ui remote      # API only
bos dev                  # Full local (rarely needed)
```

## Port Assignments

| Service | Port | URL |
|---------|------|-----|
| host | 3000 | http://localhost:3000 |
| api | 3001 | http://localhost:3001 |
| auth | 3002 | http://localhost:3002 |
| ui | 3003 | http://localhost:3003 |
| ui-ssr | 3004 | http://localhost:3004 |
| plugins | 3010+ | http://localhost:3010+ |

## Service-Descriptor Architecture

The orchestrator builds a `ServiceDescriptorMap` from `bos.config.json`. Each descriptor defines:
- `key` — service identifier (host, ui, api, auth, plugin:*)
- `source` — `"local"` or `"remote"` (determines if process is spawned or URL is probed)
- `port` / `defaultPort` — TCP port for local services
- `readinessPath` — HTTP path for readiness probes (e.g., `/health`, `/remoteEntry.js`)
- `readyPatterns` / `errorPatterns` — Regexes matched against stdout/stderr

The orchestrator:
1. Spawns local services via `bun run dev` in each package directory
2. Probes remote services via HTTP GET to their readiness path
3. Tracks process state: pending → starting → ready → error
4. Writes logs to `.bos/logs/{service}.log`

## Hot Reload

- **UI changes**: Rsbuild HMR — instant at :3003, no rebuild
- **API changes**: Rspack HMR — instant at :3001, no rebuild
- **Config changes**: Require host restart (`bos kill && bos dev --host remote`)

## Contract Sync & Type Generation

Plugin types are auto-generated from `bos.config.json` via `bos types gen`:

```bash
bos types gen   # Regenerate ui/src/api-contract.gen.ts and api/src/plugins-client.gen.ts
```

**When it auto-runs:**
- `bun install` (postinstall hook)
- `bun typecheck`
- `bos dev` startup
- `bos build`, `bos deploy`, `bos publish`
- `bos pluginAdd` / `bos pluginRemove`

**How plugin types are resolved:**
1. `local:plugins/<name>` → reads `src/contract.ts` directly from disk
2. Remote URL → fetches contract types from the deployed plugin's manifest
3. Missing local path with no URL → skipped with a warning

**Source of truth:** `bos.config.json`. If a plugin is listed there, its routes appear on `ApiContract`. If removed, TypeScript catches stale usage.

**After hand-editing `bos.config.json`:** Run `bos types gen` or restart `bos dev` to pick up changes.

## Runtime Config Loading

The host reads `BOS_RUNTIME_CONFIG` at startup (resolved from `bos.config.json` by the CLI). `ConfigService` is an immutable Effect Layer — every service is built from that one snapshot.

On page refresh:
1. Browser re-fetches HTML shell from host
2. Host injects current config into `window.__RUNTIME_CONFIG__`
3. Module Federation container re-initializes from fresh `remoteEntry.js`

This means a new deployment requires a host restart to pick up new URLs.

## Debugging

```bash
bos ps                    # List running processes + ports
bos status                # Check remote health
ls .bos/logs/             # Available log files
cat .bos/logs/api.log     # API process logs
```

API not responding:
1. `bos ps` — is API running?
2. `.bos/logs/api.log` — startup errors?
3. `curl http://localhost:3001/remoteEntry.js` — is the entry accessible?

UI not loading:
1. Check browser console for Module Federation errors
2. `bos.config.json` — is `app.ui.development` correct?
3. Clear browser cache and hard reload

Module Federation errors:
- Verify shared dependency versions match across package.json files
- Clear browser cache (Cmd+Shift+R)
- Check `bos.config.json` URLs are accessible

## Production Mode

```bash
bos start --no-interactive                    # All remotes, production URLs
bos start --env staging --no-interactive      # Staging environment
bos start --account foo.near --domain bar.com # Load specific config
```

## Process Management

```bash
bos ps              # Show PID, name, port, started time
bos kill            # Graceful SIGTERM → SIGKILL
bos kill --force    # Immediate SIGKILL
```

Process tracking uses `.bos/pids.json`.
