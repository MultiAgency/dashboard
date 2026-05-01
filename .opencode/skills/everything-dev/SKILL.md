---
name: everything-dev
description: Build, edit, deploy, and iterate on the everything.dev runtime-composed site. Covers bos dev workflow, opencode integration, authClient, apiClient, deployment cycle, and hot reload architecture.
---

# everything.dev skill

## Architecture

everything.dev is a runtime-composed site on NEAR. A published `bos.config.json` defines how the host, UI, and API fit together. Nothing is a single fixed bundle.

```
┌─────────────────────────────────────────────────────────┐
│                    Host (Server)                        │
│  - Hono.js + oRPC router                               │
│  - Runtime config loader (bos.config.json)              │
│  - Module Federation host                               │
│  - every-plugin runtime                                │
└─────────────────────────────────────────────────────────┘
            ↓                         ↓
┌───────────────────────┐ ┌───────────────────────┐
│    UI Remote           │ │    API Plugin          │
│  - React 19            │ │  - every-plugin         │
│  - TanStack Router     │ │  - oRPC contract        │
│  - Module Federation   │ │  - Effect services      │
└───────────────────────┘ └───────────────────────┘
```

Key point: `bos.config.json` is the single source of truth. URLs and composition are loaded at runtime, not baked into a build.

### How runtime loading works

1. **Host starts** — reads `BOS_RUNTIME_CONFIG` env var (resolved from `bos.config.json` by the CLI)
2. **Config is frozen** — `ConfigService` is an immutable Effect Layer; every service was built from that one snapshot
3. **UI loads** — Module Federation fetches `remoteEntry.js` from the UI URL in config; client-side `hydrate()` reads `window.__RUNTIME_CONFIG__`
4. **API loads** — `every-plugin` fetches the API remote from the URL in config; mounts oRPC router at `/api/rpc`
5. **On page refresh** — browser re-fetches HTML shell from host, which injects current config; MF container re-initializes from fresh `remoteEntry.js`

This means:
- **In dev**: file changes hot-reload instantly via HMR at `:3002`
- **In production**: a new deployment updates `bos.config.json` with new CDN URLs; host restart picks up new config; next refresh loads new UI/API

### Why restart is needed after deployment

The host freezes `BOS_RUNTIME_CONFIG` at startup. Config, plugins, and MF modules are loaded once and cached. To pick up new URLs after `bos publish --deploy`:

```bash
bos kill              # kill running processes
bos dev --host remote # restart with new config
```

This is a design choice, not a limitation — production hosts restart via deployment (Railway, Docker) rather than hot-swap.

## Dev workflow

1. Start the dev server:

```bash
# Typical: remote host, local UI + API
bos dev --host remote

# UI on http://localhost:3002
# API on http://localhost:3014
# Host on remote (production URL from bos.config.json)

# Isolate work on UI only (API is remote)
bos dev --api remote

# Isolate work on API only (UI is remote)
bos dev --ui remote

# Full local (rarely needed, initial setup only)
bos dev
```

2. Edit files — changes hot-reload at `:3002` with no rebuild
3. Run `bun typecheck` to verify types before committing

### Using opencode

```bash
# Install opencode
curl -fsSL https://opencode.ai/install | bash

# Start in the project root
opencode

# It auto-discovers:
# - AGENTS.md (operational guide)
# - LLM.txt (deep technical reference)
# - .opencode/skills/ (this skill + bos skill)
# - .agent/skills/ (bos CLI skill)

# Example prompts:
# "add a /weather page that shows the current weather using apiClient"
# "create an authenticated settings page at /settings that uses authClient"
# "add a new API endpoint in contract.ts for listing organizations"
```

### opencode server mode (advanced)

opencode can also run as an HTTP server for programmatic access:

```bash
# Start alongside bos dev
opencode serve --port 4096 --cors http://localhost:3002

# Available endpoints:
# POST /session/:id/message  — send a prompt
# GET  /event                — SSE stream of events
# POST /session/:id/command  — execute slash commands
# GET  /file/content?path=p  — read files
# GET  /find?pattern=regex   — search files
```

The JS SDK (`@opencode-ai/sdk`) provides a TypeScript client for building integrations:

```typescript
import { createOpencode } from "@opencode-ai/sdk";

const { client } = await createOpencode({ port: 4096 });

// Create a session and send a prompt
const session = await client.session.create({ body: { title: "edit page" } });
const result = await client.session.prompt({
  path: { id: session.id },
  body: {
    parts: [{ type: "text", text: "add a /status page that shows the API health" }],
  },
});
```

This enables future integrations where the UI could prompt opencode to make changes.

## Deployment workflow

After editing and verifying locally:

```bash
# 1. Type check
bun typecheck

# 2. Build and deploy all workspaces (updates bos.config.json with production URLs)
bos publish --deploy

# 3. Or build individually:
cd ui && bun run build        # builds + deploys to Zephyr CDN
cd api && bun run build       # builds + deploys to Zephyr CDN

# 4. Sync from published config (if pulling from upstream)
bos sync

# 5. Docker (alternative)
docker build -t everything-dev .
docker run -p 3000:3000 everything-dev
```

After deployment, `bos.config.json` is automatically updated with new Zephyr CDN URLs (production URLs + integrity hashes).

## Full edit → verify → deploy cycle

```bash
# 1. Start dev
bos dev --host remote

# 2. Edit files (opencode or manual)
#    changes auto-reload at :3002

# 3. Verify
bun typecheck

# 4. Deploy (builds + uploads to Zephyr CDN + updates bos.config.json)
bos publish --deploy

# 5. Restart to pick up new config
bos kill && bos dev --host remote
```

## Key clients

### authClient

```typescript
import { authClient } from "@/app";

// Check session
const { data: session } = await authClient.getSession();
if (!session?.user) { /* redirect to /login */ }

// NEAR Sign In (SIWN)
await authClient.signIn.near({ ... });

// Email/password
await authClient.signUp.email({ email, password, name });
await authClient.signIn.email({ email, password });

// Anonymous
await authClient.signIn.anonymous();
```

### apiClient (via useApiClient hook)

```typescript
import { useApiClient } from "@/lib/use-api-client";

function MyComponent() {
  const apiClient = useApiClient();
  // apiClient has all oRPC contract methods with full type safety
  const { data } = await apiClient.getRegistryApp({ accountId: "...", gatewayId: "..." });
}
```

For route-level queries, prefer TanStack Query:

```typescript
import { useQuery } from "@tanstack/react-query";

const query = useQuery({
  queryKey: ["registry-app", accountId],
  queryFn: () => apiClient.getRegistryApp({ accountId, gatewayId }),
  staleTime: 5 * 60_000,
});
```

### RootRoute loader data

The root route (`__root.tsx`) provides `runtimeConfig` via `useLoaderData()`:

```typescript
import { Route as RootRoute } from "../__root";
import { getActiveRuntime } from "@/app";

function MyPage() {
  const { runtimeConfig } = RootRoute.useLoaderData();
  const activeRuntime = getActiveRuntime(runtimeConfig);
  // activeRuntime.accountId, activeRuntime.gatewayId
}
```

## Adding a new page

1. Create a file in `ui/src/routes/_layout/` — for example `ui/src/routes/_layout/my-page.tsx`
2. TanStack Router auto-generates the route tree on save
3. The route path is derived from the file name: `my-page.tsx` → `/my-page`

### Page template

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge, Card, CardContent, UnderConstruction } from "@/components";
import { getAppName } from "@/app";

export const Route = createFileRoute("/_layout/my-page")({
  head: () => ({
    meta: [
      { title: "My Page | app" },
      { name: "description", content: "Description of my page." },
    ],
  }),
  component: MyPage,
});

function MyPage() {
  return (
    <div className="space-y-10">
      <section className="space-y-5">
        <Link
          to="/"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors font-mono"
        >
          &larr; back home
        </Link>
        <div className="space-y-4 max-w-3xl">
          <Badge variant="outline">my-page</Badge>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            My Page
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
            Description goes here.
          </p>
        </div>
      </section>
    </div>
  );
}
```

### Authenticated page template

For pages requiring login, create the file under `_authenticated/`:

```tsx
// ui/src/routes/_layout/_authenticated/my-page.tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_authenticated/my-page")({
  component: MyPage,
});
```

The `_authenticated.tsx` layout handles the session check and redirect to `/login`.

## Available components

Import from `@/components`:

- `Badge` — variants: `default`, `outline`, `secondary`, `destructive`
- `Button` — variants: `default`, `outline`, `ghost`, `destructive`; sizes: `sm`, default
- `Card`, `CardContent`, `CardDescription`, `CardFooter`, `CardHeader`, `CardTitle`
- `Dialog`, `DialogClose`, `DialogContent`, `DialogDescription`, `DialogFooter`, `DialogHeader`, `DialogOverlay`, `DialogPortal`, `DialogTitle`, `DialogTrigger`
- `Input`, `Label`
- `ScrollArea`, `ScrollBar`
- `Tabs`, `TabsContent`, `TabsList`, `TabsTrigger`
- `UnderConstruction` — takes `label` and `sourceFile` props

## Styling rules

Use semantic Tailwind classes only. No hardcoded colors. No code comments in implementation files.

```css
/* Good */
bg-background   text-foreground
bg-card         text-card-foreground
bg-primary      text-primary-foreground
bg-secondary    text-secondary-foreground
bg-muted        text-muted-foreground

/* Bad */
bg-blue-600     text-white
bg-gray-100     text-gray-800
```

## Adding API endpoints

1. Define in `api/src/contract.ts` — the oRPC contract
2. Implement handler in `api/src/index.ts` — the `createRouter` function
3. Use in UI via `apiClient` from the `useApiClient()` hook

## Type checking

After any changes:

```bash
bun typecheck
```

This checks both UI and API packages.

## Useful references

- `AGENTS.md` — operational guide for this repo
- `LLM.txt` — deep technical reference
- `bos.config.json` — runtime configuration
- `.agent/skills/bos/` — bos CLI skill
- `ui/public/skill.md` — public-facing agent guide
- `ui/public/llms.txt` — public-facing summary