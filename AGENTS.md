# Agent Instructions

Operational guidance for AI agents working on the **Agency Dashboard Template** repo (maintained by [MultiAgency](https://github.com/MultiAgency); built on the [everything.dev](https://github.com/NEARBuilders/everything-dev) runtime, scaffolded via `bos init`). The repo is a fork-and-customize template for on-chain agencies. Same routes for everyone — `/`, `/work`, `/team`, `/treasury`, `/payouts`, `/docs`, plus three intake forms (`/apply` for contributors, `/register` for founders, `/contact` for clients) — with operator-only sections (Manage Projects, Allocations, Contributors, Applications Inbox, Billings, Proposals) revealed inline on the matching public route when the signed-in NEAR account holds an operator role on the DAO. `/admin/projects/$slug` is the only deep-admin route; `/settings` configures agency identity + DAO. Verify what exists in `ui/src/routes/` and `api/src/contract.ts` before assuming a surface is missing.

## Quick Reference

**Start Development:**
```bash
cp .env.example .env   # First time only
bun install
bun run db:migrate     # Apply API migrations (one-time per fresh checkout)
bun run dev
```

**Publish:**
```bash
bos publish           # Publish config to the FastKV registry
bos publish --deploy  # Build/deploy all workspaces, then publish
```

## Architecture

This is a **Module Federation monorepo** with runtime-loaded configuration. The host is **remote** — it is not in this repository. You only work on `/ui` and `/api` (plus any plugins).

```
┌─────────────────────────────────────────────────────────┐
│                    Host (Remote)                        │
│  - Hono.js + oRPC router                               │
│  - Runtime config loader (bos.config.json)              │
│  - Module Federation host                               │
│  - every-plugin runtime                                │
└─────────────────────────────────────────────────────────┘
            ↓                         ↓
┌───────────────────────┐ ┌───────────────────────┐
│    UI (Local)         │ │    API Plugin (Local)  │
│  - React 19           │ │  - every-plugin        │
│  - TanStack Router    │ │  - oRPC contract        │
│  - Module Federation  │ │  - Effect services     │
└───────────────────────┘ └───────────────────────┘
```

The host loads UI and API at runtime from URLs in `bos.config.json`. No rebuild is needed when URLs change.

### Runtime Config

All runtime configuration lives in `bos.config.json`. The UI reads `window.__RUNTIME_CONFIG__` to get account, gateway, API base URL, etc.

Use these helpers from `@/app`:
- `getAppName()` — active runtime title (falls back to account)
- `getAccount()` — NEAR account from config
- `getRepository()` — repository URL from config
- `getActiveRuntime()` — active runtime info (accountId, gatewayId, title)
- `getRuntimeConfig()` — full client config

## Architectural Decisions (v1)

Load-bearing facts for any agent making changes:

- **DAO-canonical role gating.** `api/src/index.ts` defines a `requireRoles(roles: RoleKey[])` middleware factory and a `gates` registry of common compositions: `gates.admin` (strict Admin), `gates.approver` (strict Approver), `gates.requestor` (strict Requestor; kept for symmetry, no current consumer), `gates.operator` (Admin OR Approver — operational write tier), `gates.member` (Admin OR Approver OR Requestor — member-internal read tier). Each surface declares its admit-set explicitly via `.use(gates.<key>)`. Role names resolve from `agency_settings.adminRoleName` / `approverRoleName` / `requestorRoleName` (schema-defaulted to `Admin` / `Approver` / `Requestor` — Trezu's on-chain role names; Sputnik's own `default_policy()` uses `all`/`council` instead); override via `/settings` for non-Trezu DAOs. The DAO is the source of truth — `userInRole` calls `get_policy` via NEAR RPC; the local DB only stores override names. Per-surface gate selection: governance decision → `gates.admin` (e.g., applications.adminUpdate, contributors.adminCreate/Update, settings.adminUpdate); financial action → `gates.approver` (e.g., allocations write paths, billings.adminCreate, treasury.getBalances, projects.getBudget); operational either-or → `gates.operator` (lists — including `allocations.adminList` and `billings.adminList` — plus project create/update, assignments, nearn reads, settings.adminGet); member-internal read → `gates.member` (projects.adminList). Strict per-role gates available for ad-hoc surfaces; ad-hoc compositions via `requireRoles(["admin", "requestor"])` etc. The dashboard observes resulting Sputnik proposals via `getProposal` — Requestor-tier write flows (filing payment requests) live on NEARN/Trezu, not on this dashboard.
- **Treasury = Sputnik DAO contract.** A treasury IS a Sputnik DAO contract — one onchain account that custodies funds and gates spending via member voting. "Treasury" and "DAO" refer to the same contract. The agency configures one `daoAccountId` in `agencySettings`. Trezu is a user-facing UI for interacting with Sputnik DAO contracts; the dashboard is a sibling UI that observes the same contract via NEAR RPC. Trezu has no public REST API.
- **Projects optionally link to a NEARN listing via `nearnListingId`.** When populated, the link is 1-1 (admin pastes the NEARN bounty slug; convention-enforced, not schema-unique). `nearnListingId` is nullable: a project may be brokered through channels other than NEARN (e.g. GitHub issues, direct email, partnership contracts, internal ops) and exist locally without a NEARN counterpart. NEARN's listing-fetch endpoint is undocumented (treat as fragile); `services/nearn.ts`'s `getNearnListing` consumes it. The public projects index enriches local rows with live NEARN data per request and degrades to local `title`/`slug` on fetch failure. Local `status` is the agency's lifecycle state (active/paused/archived), independent of any NEARN status. `organizationId` IS the agency id. `ownerId` is the NEAR account that created the project.
- **Project description is member + assigned-contributor context, not public.** Returned by `projects.adminGet` to admins, approvers, requestors (DAO members of any tier), and contributors assigned to the project (`requireSession` middleware + inline check that admits any of the three DAO roles OR matches a contributor row's `nearAccountId` against the project's assignees). The public `projects.list` route uses the `publicProject` shape in `api/src/contract.ts` (which `omit({ description: true })`s the field); deep public narrative lives on NEARN. Local description is a fallback for the member/contributor view, not for public listing.
- **Contributors are agency-internal vendor records that may link to a NEARN profile.** `nearAccountId` is nullable: the dashboard supports tracking contributors before they create a NEARN profile (e.g. for legal/compliance). `name` is required; `email` is optional. When `nearAccountId` is populated, NEARN is the canonical identity source; until then the local row is the source of truth. The dashboard owns onboarding status (`onboardingStatus`: pending/complete/expired) regardless. Compliance documents themselves (tax forms, contracts) live in the operator's existing systems, not the dashboard — status tracking only.
- **No duplication of NEARN/Trezu features.** If NEARN or Trezu (= Sputnik DAO via Trezu's UI) already provides a feature, the dashboard links out or fetches; it does not reimplement. This is the principle that produced the two overlay shapes above.
- **Dashboard reads treasury balance from chain, not from a stored copy.** Allocation rollups sanity-check against live treasury holdings (NEAR + FT balances on the DAO account, fetched via NEAR RPC view calls in `services/sputnik.ts`). Caching follows the existing `get_policy` TTL pattern. The dashboard surfaces an explicit warning when sum of allocations exceeds treasury balance per token.
- **Allocations are positive; corrections come from named verbs, not signed input.** Three write paths into `allocations`: `adminCreate` (positive row), `adminDeallocate` (positive input, handler writes `-amount`, `relatedAllocationId` null — the project-scoped negative path), `adminTransfer` (paired `-from` / `+to` rows linked via `relatedAllocationId`). The contract's `baseAmount` validator is positive-only; handlers do the signing. UI forms accept positive amounts and pick the verb at click time. Project budgets are allowed to go negative — over-allocation surfaces as a UI warning and destructive-styled `remaining` tile, not blocked at the API.
- **Single-tenant in v1.** Multi-tenant tooling (active-org switching, multiple DAOs in one deployment) is deferred to v2.
- **Public surface posture: chain-derived read-only data MAY be public; locally-authored operational data is admin-only.** The dashboard surfaces two categories of data with different rules. **Chain-mirroring** (allowed public): routes that reshape state already queryable via NEAR RPC — DAO roles and members (`team.list`/`getPublicSummary`), treasury balances (`treasury.getPublicBalances`/`getPublicSummary`), Sputnik transfer proposals (`proposals.list`/`getPublicSummary`). Hiding the UI doesn't hide the data; the product posture is transparency, codified in the schema-defaulted tagline "Open Books · Open Source · Open Doors". **Locally-authored** (admin-only): allocations, billings, contributor records and compliance status, applications, project descriptions, project budgets, project↔contributor assignments. None of this is on-chain; gating happens via the `gates` registry. The principle generalizes: a new route that calls NEAR RPC and reshapes the result is fine public; a new route that selects from a local table is not. The public projects directory (`agency.projects.list`) returns `projectWithNearn` — `publicProject.extend({ nearnListing })` where `publicProject = project.omit({ description: true })`; re-introducing `description` or adding a public single-project route requires revisiting this rule. Forks that disagree with this posture delete or move the routes — they're template-excluded.
- **Agency table join shape.** Project-scoped tables (`allocations`, `billings`) foreign-key to `projects.id` via `projectId`; agency scope is implicit through `projects.organizationId`. Agency-scoped tables (`applications`, `contributors`) have no `projectId` column — `applications` is a public-inquiry table; `contributors` links to projects via `projectContributors`, a join table with composite PK `(projectId, contributorId)`.
- **Billings are 1:1 with Sputnik DAO Transfer proposals; status, recipient, token, and amount all come from chain.** MultiAgency commits to "every contributor payment is a DAO proposal" — `billings.proposalId` is `NOT NULL UNIQUE` (enforced via `billings_proposal_unique`), and there is no off-chain billing. The `billings` row is a slim project-scoping wrapper around an on-chain proposal. **At create time** (`billings.adminCreate`), the operator inputs only `projectId` + `proposalId` (+ optional `contributorId` override + optional `note`); the handler fetches the proposal via `getProposal`, rejects non-`Transfer` kinds with `BAD_REQUEST`, and derives `tokenId` / `amount` / `contributorId` from the proposal payload (`receiver_id` looked up against `contributors.nearAccountId`). **At read time** (`adminList`, `computeBudget`), rows are enriched with `getProposal(daoAccountId, proposalId).status` — the seven-state Sputnik enum (`InProgress` / `Approved` / `Rejected` / `Removed` / `Expired` / `Moved` / `Failed`). The lifecycle field (`status`) is **not stored**; terminal proposal statuses are cached indefinitely in `services/sputnik.ts` since Sputnik's terminal states are absorbing. There is no `billings.adminUpdate` and no operator transcription path. Budget rollup: `paid` = sum where `status === "Approved"`; `allocated` = sum excluding terminal-fail (`Rejected`/`Removed`/`Expired`/`Moved`/`Failed`); `remaining` = `budget - allocated`. Operators view actual chain state via the per-row Trezu deep-link (`https://trezu.app/<daoAccountId>/requests/<proposalId>`, network-correct via the daoAccountId path segment). Don't reintroduce a local `status` column, an auto-reconcile pattern, or operator-typed token/amount fields — chain is the single source of truth.
- **Effect usage policy: at the boundary, plain async inside.** `Effect.gen` / `Effect.promise` are used in `createPlugin`'s `initialize` / `shutdown` hooks (the framework boundary). Inside services (`api/src/services/sputnik.ts`, `api/src/services/nearn.ts`) and route handlers, plain `async`/`Promise` code with `Map`-based caches is the convention. Don't lift services into Effect-Tag layers without an architectural reason (cache + retry + typed errors as a unit, or testability via Tag swap). Stay consistent with the established split.
- **u128-shaped fields are coerced with `String(...)`, not parsed by a tight zod schema.** Older Sputnik deployments JSON-encode `U128` fields as numbers; newer ones as strings. A tight `z.string()` `.parse()` throws silently → query resolves to undefined → UI shows empty state while a `curl` against the same RPC returns rows. The established pattern in `parseProposal` and the FT/NEAR balance fetchers is `String(raw.field ?? "0")` — accept either and normalize to string at the deserialization boundary. Apply this to every new contract view that returns a u128-shaped field (`amount`, `balance`, `share_price`, vote counts, bond, gas). On the client, downstream code can safely `BigInt(value)` once normalized. Use `parseInt`/`parseFloat`/`Number(...)` on u128 strings is the bug.
- **Agency-identity defaults are placeholder.** `name`, `headline`, `tagline`, and role-name fields in `agency_settings` ship with MultiAgency reference values; override via `/settings`.
- **Bootstrap path: every fork repoints `agency_settings.daoAccountId` from the placeholder before any admin surface works.** The plugin's `initialize` seeds the row with `process.env.AGENCY_DAO_ACCOUNT ?? DEFAULT_DAO_ACCOUNT`. Two paths converge on the same end state: (a) set `AGENCY_DAO_ACCOUNT` env var before deploying — `initialize` seeds the row from it the next time the process starts against an empty row; (b) call `bootstrap.config` from the UI's "Set up your worksite" affordance on `/settings`, which is gated only by an inverse `userInRole(input.daoAccountId, actor, adminRoleName)` check — i.e., the claimer must demonstrate independent admin control of the destination DAO. The `_authenticated/_configured.tsx` pathless layout's `beforeLoad` redirects all admin-gated routes to `/settings` when `settings.getPublic.isPlaceholder` is true; once `daoAccountId !== DEFAULT_DAO_ACCOUNT`, the claim route rejects further calls and normal admin gating applies. Don't relax `settings.*` gates; bootstrap concerns belong in `bootstrap.*`.
- **Chain position: downstream of everything.dev, upstream of agency forks.** `bos.config.json`'s `extends: bos://auth.everything.near/everything.dev` makes this a fork of the framework; `bos publish --deploy` publishes our config to `bos://agency.near/multiagency.ai` for downstream agency forks to extend. Three files govern propagation: `.templatekeep` (what downstream agencies copy on `bos init`), `.templatesync-exclude` (what every agency owns and never inherits from us — branding, routes, contract, schema, services, migrations), `.bos/sync-local-exclude` (this fork's own protections when we run `bos sync` against everything.dev — routes, public assets, top-level docs, plugins). Pull framework updates via `bos upgrade` (bumps `everything-dev` and `every-plugin`, then runs sync); publish our updates downstream via `bos publish --deploy`. Per-fork identity (DAO account, NEARN slug, name, taglines) is configured at runtime in `agencySettings`, not at fork time — `bos init` ships scaffolding, not deployment-specific values.
- **Public docs are registered in `ui/src/lib/docs-registry.ts` and served from one of two paths.** The `/docs` route iterates the registry; each entry's `source` field picks the served path. **Mirrored skills** (`source: "skills"`) live at `ui/public/skills/<slug>.md` and mirror `.opencode/skills/<slug>/SKILL.md` verbatim — update both files when editing. **Fork-authored skills** (`source: "docs"`) live at `ui/public/docs/<slug>.md` with no upstream mirror; this is where MultiAgency-specific operating-model content goes (entity, contributors, services agreement, work order). Don't add a third DOCS array elsewhere — the registry is the single source of truth for `index.tsx` + `$slug.tsx`.

## Development Workflow

### Typical Session
1. `bun run dev` to start development
2. UI at http://localhost:3003; API at http://localhost:3001 (default ports from upstream's `service-descriptor.ts`; rsbuild/rspack auto-bump up if a parallel session is on those ports — host on 3000 has no auto-bump and will fail with EADDRINUSE if taken)
3. Check `.bos/logs/` for process logs if issues occur
4. Stop with Ctrl+C in the dev terminal (no `bos kill` subcommand exists in v1.9.x); if processes persist, `lsof -i :3000-3004 -P | grep LISTEN` and `kill <PID>` the stragglers

### Debugging Issues

**API not responding:**
- Verify `bun run dev` is still running in its terminal
- Check `.bos/logs/api.log` for errors

**UI not loading:**
- Verify `bun run dev` is still running in its terminal
- Check browser console for Module Federation errors
- Clear browser cache and retry

**Type errors:**
- Run `bun typecheck`
- Ensure `api/src/contract.ts` is in sync with UI usage

## Code Changes

### Making Changes
- **UI Changes**: Edit `ui/src/` files → hot reload automatically
- **API Changes**: Edit `api/src/` files → hot reload automatically
- **New Components**: Create in `ui/src/components/ui/`. Export from `ui/src/components/index.ts` only when consumed across multiple call sites; single-call-site primitives import directly from `@/components/ui/<name>`.
- **New Routes**: Create file in `ui/src/routes/`, TanStack Router auto-generates tree

### Style Requirements
- Use semantic Tailwind classes: `bg-background`, `text-foreground`, `text-muted-foreground`
- No hardcoded colors like `bg-blue-600`
- No code comments in implementation
- Follow existing patterns in neighboring files
- `bg-accent` (yellow) on `bg-background` (cream) requires a `border-foreground` border to be visible — surface contrast alone is 1.07:1; the 2px black border is load-bearing on primary CTAs

### Adding API Endpoints
1. Define in `api/src/contract.ts` — the oRPC route definitions and Zod schemas
2. Implement in `api/src/index.ts` — the `createRouter` function
3. Use in UI via `apiClient` from `useApiClient()` hook

**Conventions for admin endpoints:**

- **Namespace.** Nest fork-specific procedures under `agency.<entity>` (e.g. `agency.projects.list`). Top-level keys on `apiClient` (`projects`, `auth`, …) are reserved for upstream-plugin contracts that `bos types gen` folds into `ApiContract` — those procedures appear in autocomplete but aren't callable through this client (the fork's API doesn't implement them). The `agency.` prefix keeps fork procedures visually distinct from that type noise. Today only `projects` is nested; the rest (`contributors`, `allocations`, `billings`, `assignments`, `settings`, `team`, `bootstrap`) sit at top-level and should migrate under `agency.` as they're touched.
- **Gating.** Pick the gate that matches the surface from the `gates` registry: `gates.admin` (governance), `gates.approver` (finance), `gates.operator` (Admin OR Approver — most operational ops), `gates.member` (Admin OR Approver OR Requestor — member-internal reads), `gates.requestor` (strict, for symmetry). Apply via `builder.<name>.use(gates.<key>).handler(...)`. For ad-hoc compositions, use the `requireRoles([...])` factory directly. Server gates by Sputnik DAO role; client gating is advisory only. For surfaces with mixed gating (e.g., role check OR project assignment), use `requireSession` + an inline policy check inside the handler — see `agency.projects.adminGet` for the canonical pattern.
- **Pagination for time-series lists** (audit logs, activity, submissions). Input extends `paginationInput` (defined in `contract.ts`); output shape is `{ data, nextCursor: string | null }`. Handler: default `limit = 50`, max 200; when `input.cursor` is present, add `lt(table.createdAt, new Date(input.cursor))` to the where clause; set `nextCursor` to the last row's `createdAt.toISOString()` only when the page filled to `limit`. UI uses `useInfiniteQuery` with `getNextPageParam: (last) => last.nextCursor ?? undefined`. See `billings.adminList`, `allocations.adminList`, `applications.adminList` for working references.
- **Audit fields on review-style mutations.** When a mutation transitions a row through a review lifecycle (e.g. `applications.adminUpdate`'s status change), set `reviewedBy = context.nearAccountId ?? null` and `reviewedAt = new Date()` on every call. The UI surfaces "last reviewed by X · YYYY-MM-DD HH:MM:SS" automatically when these fields are non-null.

### Plugin Architecture

Business logic is organized into independent plugins loaded via Module Federation:
- **`api/`** — Today owns the agency surface (applications, projects, contributors, allocations, billings, assignments, settings, treasury, nearn, team, me) plus shared auth middleware.
- **`plugins/`** — No fork-authored plugins on disk. `bos.config.json` registers `projects` from upstream (NEARBuilders/everything-dev) for host loading, but this fork doesn't consume it today — the configured route patterns (`_authenticated/organizations/**`, `_authenticated/projects/**`) don't exist in `ui/src/routes/`, and no UI code calls `apiClient.projects.*` (the dashboard's project surface is nested under `apiClient.agency.projects.*`). As agency-specific plugins ship, they live in this directory, each self-contained with `contract.ts`, `index.ts`, and an rspack config for independent deployment.

The UI accesses plugin routes via namespaced clients: `apiClient.<pluginName>.<routeName>()`.

**Scaffolding a new plugin.** This fork does not vendor a local `plugins/_template/`. The canonical scaffold lives upstream at [`NEARBuilders/everything-dev/plugins/_template`](https://github.com/NEARBuilders/everything-dev/tree/main/plugins/_template), with `LLM.txt` implementation guidance in that directory and existing plugins (`auth`, `opencode`, `projects`, `registry`) as working references. The dashboard fork has not validated the end-to-end scaffolding flow itself; treat upstream as the starting point.

**Planned crossovers (anticipated, not committed).**

- **`projects` × `agency.projects`.** The upstream `projects` plugin is registered in `bos.config.json` but unconsumed; `agency.projects` owns its own schema (`nearnListingId`, `organizationId`-as-agency, `visibility`). The fork's project surface eventually layers over or merges with the upstream contract — shape undecided. Review the dashboard as if these are independent today.
- **Trezu plugin (possible).** A Trezu plugin packaging the on-chain write flows (AddMember, Transfer, ChangePolicy) is one path for relaxing the dashboard's read-only posture on Sputnik. Imported as a peer if it ships. Not committed.

### Plugin Client (pluginsClient)

The API plugin receives typed client factories for all other plugins via `createPlugin.withPlugins<PluginsClient>()`, enabling in-process composition without HTTP roundtrips.

**Two-phase loading**: The host loads non-API plugins first (Phase 1), creates a `pluginsClient` map, then loads the API with that map injected (Phase 2). The host is generic — no plugin-specific code.

**Generated types** (`api/src/plugins-client.gen.ts`, `ui/src/api-contract.gen.ts`, `ui/src/auth-types.gen.ts`) are gitignored. No install-time hook — `bos types gen` emits broken imports when `auth.development` is a `local:` path not checked out on disk. `bos dev` loads auth remotely from `auth.production` without touching these files; treat the gen files as stable once present. To regenerate when upstream auth's contract changes, temporarily point `auth.development` at the same URL as `auth.production`, run `bos types gen`, then revert.

### Workspace Dependency Versions

`api/package.json` and `ui/package.json` use literal version specifiers (e.g. `"better-auth": "1.6.9"`), not `catalog:` refs — that's upstream's template default, and these files are template-tracked. Don't "fix" workspace deps to `catalog:` refs; the next `bos sync` overwrites the change. The root `workspaces.catalog` still pins canonical versions for `overrides` and root deps; workspaces just don't reference it.

## Testing & Quality

**Before committing:**
```bash
bun test        # Run all tests
bun typecheck   # Type check all packages
bun lint        # Run linting
```

## Common Patterns

### Authentication Check
Routes requiring auth use `_authenticated.tsx` layout. Auth is NEAR-only via `better-near-auth` SIWN; there is no login page, so unauthenticated users are sent back to `/` where the landing exposes the connect button:
```typescript
import { getSessionFromData, sessionQueryOptions } from "@/lib/session";

export const Route = createFileRoute("/_layout/_authenticated")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(
      sessionQueryOptions(context.session),
    );
    const auth = getSessionFromData(session);
    if (!auth.isAuthenticated) {
      throw redirect({ to: "/" });
    }
    return { auth, session };
  },
});
```

### API Client Usage
oRPC returns the contract output shape directly — no `{ data }` envelope is added by the client. Destructure to match the contract.
```typescript
import { useApiClient } from "@/lib/use-api-client";

function MyComponent() {
  const apiClient = useApiClient();
  const { status, timestamp } = await apiClient.ping();
  const { data } = await apiClient.projects.list();
  await apiClient.applications.create({ kind, name, email });
}
```

### App Name in UI
`getAppName(config)` returns `getActiveRuntime(config)?.title ?? getAccount(config)`. Anywhere a `runtimeConfig` is in scope (loader data or `head()`), the canonical pattern is:
```typescript
import { getAppName } from "@/app";

const { runtimeConfig } = Route.useLoaderData();
const appName = getAppName(runtimeConfig) || "app";
```

## Troubleshooting

**Process won't start:**
```bash
lsof -i :3000-3004 -P | grep LISTEN  # Find stragglers, then `kill <PID>`
bun install                          # Ensure dependencies
bun run dev                          # Restart
```

**Module Federation errors:**
- Check `bos.config.json` URLs are accessible
- Verify shared dependency versions match in package.json
- Clear browser cache

**Database issues:**
```bash
bun run db:migrate  # Apply generated migrations (safe for CI/non-interactive)
bun run db:push     # Interactive schema sync (local dev only — needs a TTY)
bun run db:studio   # Open Drizzle Studio
```

### Cross-Checking Onchain State

When the dashboard's view of a Sputnik DAO disagrees with reality, verify against the chain directly before suspecting the indexer. The `near` CLI bypasses our `services/sputnik.ts` cache, NEARN, Trezu, and any local DB row:

```bash
# DAO policy (roles, members, bond, voting rules)
near contract call-function as-read-only <dao>.sputnik-dao.near get_policy \
  json-args '{}' network-config mainnet now

# Single proposal (status, kind, vote counts) — direct chain truth
near contract call-function as-read-only <dao>.sputnik-dao.near get_proposal \
  json-args '{"id": <proposalId>}' network-config mainnet now

# Last proposal id (basis for pagination — see fetchTransferProposals cursor math)
near contract call-function as-read-only <dao>.sputnik-dao.near get_last_proposal_id \
  json-args '{}' network-config mainnet now

# Available NEAR balance (treasury free-after-locked)
near contract call-function as-read-only <dao>.sputnik-dao.near get_available_amount \
  json-args '{}' network-config mainnet now

# FT balance against an NEP-141 contract
near contract call-function as-read-only <token>.near ft_balance_of \
  json-args '{"account_id": "<dao>.sputnik-dao.near"}' network-config mainnet now

# Account summary including delegations (useful for cross-checking individual signers)
near account view-account-summary <signer>.near network-config mainnet now
```

If the default RPC is rate-limited, swap `network-config mainnet` for `network-config mainnet-fastnear`.

Use this when: a proposal status looks stuck (compare to chain); over-allocation warnings fire and you want to confirm the actual treasury free-balance; a vote count in the UI looks off (u128 schema regression — see the lenience rule in Architectural Decisions); proposal pagination skips items (compare `get_last_proposal_id` to UI's `lastProposalId`).

**`GET /api/auth/near/list-accounts 401` in console on anonymous load:**
Cosmetic only. `better-near-auth`'s `siwnClient` plugin calls `restoreFromSession` unconditionally on init, which hits `list-accounts` — an endpoint gated by better-auth's standard `sessionMiddleware`. Anon → 401. The client catches it silently (`catch {}`); the 401 still surfaces in the browser's network layer log. App functionality is unaffected. Fork's server-side `resolveNearAccountId` also handles the 401 gracefully via `if (!res.ok) return undefined`. No fix locally — the `siwnClient` plugin has no `autoRestore: false` option, and patching it just for cleaner console output isn't worth the maintenance burden.

## Environment

**Required files:**
- `.env` - Secrets (see `.env.example`)
- `bos.config.json` - Runtime configuration (committed)

**Key ports** (defaults from upstream's `service-descriptor.ts`):
- 3000 - host
- 3001 - api
- 3002 - auth
- 3003 - ui
- 3010+ - plugins

UI/API auto-bump up if a parallel session occupies their slot (rsbuild/rspack handle EADDRINUSE themselves). Host has no auto-bump and fails outright if 3000 is taken — coordinate with parallel sessions or override via `app.host.development: "http://localhost:<port>"` in `bos.config.json`.
