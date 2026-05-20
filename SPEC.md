# SPEC — Agency Dashboard

Fork-specific architecture. App-owned (not synced); the durable home for guidance that AGENTS.md (framework-owned) loses on upgrade.

## Architectural Decisions (v1)

Load-bearing facts for any agent making changes. Each decision: **Rule / Why / How to apply / Anchors.**

### DAO-canonical role gating

**Rule.** Server gates resolve role names via `defaultAdminRoleName()` / `defaultApproverRoleName()` / `defaultRequestorRoleName()` (in `api/src/lib/settings-defaults.ts`) — `AGENCY_ADMIN_ROLE` / `AGENCY_APPROVER_ROLE` / `AGENCY_REQUESTOR_ROLE` env vars with hardcoded fallback `Admin` / `Approver` / `Requestor`. The DAO's `get_policy` is the single source of truth.

**Why.** Agencies may use Trezu's role names (default) or raw Sputnik's `all`/`council`. Overrides set via env at deploy time; no DB row, no UI in v1. Chain stays authoritative; client-side gating is advisory.

**How to apply.** Pick the gate matching the surface intent:
- `gates.admin` — governance (applications.adminUpdate, contributors.adminCreate/Update)
- `gates.approver` — financial *writes* (budgets writes, billings.adminCreate)
- `gates.operator` — Admin OR Approver — most operational ops (lists, project create/update, assignments, nearn reads) AND financial *reads* (treasury.getBalances, treasury.getRollups, projects.getBudget — Admin needs treasury visibility to make governance decisions even without write authority)
- `gates.member` — Admin OR Approver OR Requestor — member-internal reads (projects.adminList)
- `gates.requestor` — strict, symmetric; no current consumer (forward-scaffolding)

Apply via `builder.<name>.use(gates.<key>).handler(...)`. Ad-hoc compositions: `requireRoles([...])`. For mixed gating (role check OR project assignment), `requireSession` + inline check — see `agency.projects.adminGet`. Requestor-tier writes (filing payment requests) live on NEARN/Trezu, not here.

**Anchors.** `requireRoles` factory and `gates` registry in `api/src/index.ts`; `userInRole` in `api/src/services/sputnik.ts`.

### Treasury = Sputnik DAO contract

**Rule.** The agency's identity is `orgAccountId` — any NEAR account, resolved per request via `getOrgAccountId(reqHeaders)` (env-driven through `defaultOrgAccount(network)`). When that account is a Sputnik DAO subaccount (`isSputnikDao(orgAccountId)` true — suffix matches `.sputnik-dao.near` / `.sputnikv2.testnet`), the same account doubles as the treasury: funds custody + governance, one onchain contract. Reads through `services/sputnik.ts` (which expects a DAO). Agencies using a non-DAO `orgAccountId` configure their identity at upstream but get no treasury features.

**Why.** Decouples agency identity from treasury implementation. Top-level NEAR accounts (e.g., `multiagency.near`) yield globally-unique prefixes for upstream's `organizationId` tag; Sputnik subaccounts yield prefixes unique within the factory. Trezu is a sibling UI for Sputnik DAOs only; dashboard observes via NEAR RPC. Trezu has no public REST API.

**How to apply.** One `orgAccountId` per network per agency — agencies in multi-network deployments operate a mainnet account *and* a testnet account in parallel (see "Multi-network resolution"), each independently a DAO or non-DAO. For DAO features (treasury, roles), the operator picks Sputnik subaccount(s) on the relevant network(s). Reads go through `services/sputnik.ts` whose parameter names stay `daoAccountId` (they require a DAO); callers pass `orgAccountId` and accept that those calls only work when `isSputnikDao(orgAccountId)` is true. Don't model treasury state locally.

**Anchors.** `getOrgAccountId` in `api/src/index.ts`; `defaultOrgAccount` in `api/src/lib/default-org-account.ts`; `isSputnikDao` in `services/sputnik.ts`; `services/sputnik.ts` (DAO-specific reads).

### Projects live upstream; NEARN linkage is the local `listings` cache

**Rule.** Project rows live in NEARBuilders/everything-dev's `projects` plugin, accessed via `pluginsClient.projects(...)`. The dashboard does not own `agency.projects`. Per-project state authored in this template lives in `agency.listings`, keyed to upstream's project id with `source` discriminating `'nearn' | 'internal'`. NEARN-sourced rows cache the bounty payload (read-only canonical, lazy-refresh on stale read); internal-sourced rows are DAO-authored via `agency.listings.*` operator-tier admin CRUD — used when no NEARN listing exists (notably on testnet, where NEARN is unavailable) and as a fallback that the rollup math resolves to when NEARN is absent.

**Why.** Aligns with the four-system division (dashboard indexes upstream truth and authors admin-only operational data; doesn't author public surfaces or onchain execution). Lets NEARN data survive nearn.io downtime via the local cache. Unifies NEARN and internal listings under one `Listing` shape so the rollup math has a single resolver.

**How to apply.** Read project metadata via `plugins.projects(proxyCtx(orgAccountId)).listProjects/getProject` (always pass ctx so private DAO projects come through). Look up listing data via `getListingForProject(projectId, source, orgAccountId, db)` from `services/listings.ts` — `"nearn"` handles lazy refresh and 404→archived transitions; `"internal"` is a plain read. Never write to `agency.listings` directly: NEARN rows go through `attachNearnListing` / `detachNearnListing`; internal rows go through `createInternalListing` / `updateInternalListing` / `deleteInternalListing`. NEARN and internal rows may coexist on one project; the rollup `resolveActiveListing` falls through to internal only when NEARN is absent.

**Anchors.** `services/listings.ts`; `agency.listings` schema; `agency.listings.*` contract namespace; `proxyCtx` + `fetchOrgProjects` helpers in `api/src/index.ts`.

### Proxy upstream calls as the organization identity, never the operator

**Rule.** Every `plugins.projects(...)` call uses `proxyCtx(orgAccountId)` for ownership context — sets upstream's `userId` / `walletAddress`, which upstream uses to derive each project row's `ownerId`. The upstream `organizationId` input/filter is the full `orgAccountId` itself; no derivation. Never proxy as the operator's `nearAccountId`. The only exception is the public `list` handler, which calls `plugins.projects()` with no context and an explicit `visibility: "public"` filter.

**Why.** Upstream's `canEditProject` matches strictly on `ownerId === userId`; there is no concept of organization membership at the plugin layer. If operators proxied as themselves, only each project's original creator could edit it — multi-operator DAOs would break. Proxying as the org makes every project `ownerId = organizationId`, so any DAO operator can edit any DAO project, and upstream's `(ownerId, slug)` slug-uniqueness becomes the org-scoped constraint we actually want. Using the full `orgAccountId` rather than a derived prefix means testnet and mainnet DAOs land in distinct upstream namespaces by construction — the `.testnet` / `.near` suffix carries network identity, so cross-network collision is impossible.

**How to apply.** Use `proxyCtx(orgAccountId)` for the context, `orgAccountId` directly for the `organizationId` input/filter. Strict-equality guards on returned rows: `result.data.organizationId !== orgAccountId` throws `NOT_FOUND`. Per-operator audit lives locally in `agency.budgets.actorAccountId` and `agency.billings.actorAccountId` — upstream sees only "the org did it."

**Anchors.** `proxyCtx` + `requireProjectInOrg` in `api/src/index.ts`; SPEC's "Schema change (projects move upstream)" section.

### Project description is member + contributor context, not public

**Rule.** `projects.description` is admin-internal "notes". Returned by `projects.adminGet` to DAO members (any tier) and contributors assigned to the project. The public `agency.projects.list` returns `publicProject` shape which omits `description`.

**Why.** Deep public narrative lives on NEARN. Local description is fallback for member/contributor view, not public listing.

**How to apply.** Gate admin detail with `requireSession` + inline check admitting any of the three DAO roles OR a matching contributor assignment. Don't add a public single-project route without revisiting public surface posture.

**Anchors.** `agency.projects.adminGet`, `publicProject` in `api/src/contract.ts`.

### Contributors are agency-internal vendor records

**Rule.** `nearAccountId` nullable (support pre-NEARN tracking for legal/compliance). `name` required; `email` optional. Dashboard owns `onboardingStatus` (pending/complete/expired) regardless of NEARN linkage. Compliance documents themselves (tax forms, contracts) live in the operator's existing systems — status tracking only.

**Why.** When `nearAccountId` is populated, NEARN is canonical identity; until then the local row is source of truth. PII storage stays out of the dashboard.

**How to apply.** Don't add compliance document storage. Keep `onboardingStatus` as the only lifecycle field; PII pointers stay external.

**Anchors.** `contributors` table in `api/src/db/schema.ts`.

### No duplication of NEARN/Trezu features

**Rule.** If NEARN or Trezu (= Sputnik DAO via Trezu's UI) already provides a feature, the dashboard links out or fetches; it does not reimplement.

**Why.** The dashboard is an observability + planning layer over four systems. Duplicating financial-action or marketplace surfaces creates parallel state machines and reconciliation bugs.

**How to apply.** Before adding any write surface, ask: does Sputnik (via Trezu) or NEARN already do this? If yes, link out.

**Anchors.** Produces the project/contributor overlay shapes above and the billings pointer-only design below.

### Dashboard reads treasury balance from chain

**Rule.** Budget rollups sanity-check against live treasury holdings (NEAR + FT balances on the DAO account, fetched via NEAR RPC). Cache TTL follows the `get_policy` pattern. UI surfaces explicit warning when sum of budgets exceeds treasury balance per token. Note: `budgeted` (sum of `budgets` rows) and `allocated` (active NEARN listing reward, NEARN-derived) are distinct stages in the rollup model — see SPEC's "Target rollup model" — and this rule is about the budgeted side.

**Why.** Stored treasury copy = stale on every transfer; we'd reimplement Sputnik's accounting badly.

**How to apply.** Use `services/sputnik.ts` for chain reads. Don't add a `treasuryCache` table.

**Anchors.** `services/sputnik.ts.getTreasuryBalances`; `get_available_amount` DAO contract method.

### Treasury tokens are discovered via FastNEAR's account-ft indexer

**Rule.** `getDaoTokenIds(orgAccountId)` calls FastNEAR's `/v1/account/{id}/ft` endpoint (mainnet `api.fastnear.com`, testnet `test.api.fastnear.com`), filters out zero-balance entries, and prepends `"near"`. Cached 60s with stale-while-error on failure. `KNOWN_TOKENS` is a metadata-only registry — icon, symbol, decimals, display name; unknown FTs (no registry entry) fall back to on-chain `getFtMetadata(contractId, ownerAccountId)`.

**Why.** Sputnik has no view method for FT inventory, but FastNEAR's indexer answers "what FTs does this account currently hold?" in a single REST call. This reflects actual holdings (including tokens received via direct `ft_transfer`, not just Sputnik Transfer proposals) and avoids the cold-start gap of proposal-history-based discovery — `/treasury` shows the full token list on first load. Aligns with [Trezu's primary discovery path](https://github.com/NEAR-DevHub/trezu/blob/main/nt-be/src/handlers/balance_changes/token_discovery.rs); Trezu additionally scans transaction receipts and the NEAR Intents multi-token contract for completeness, which we don't need for v1.

**How to apply.** Don't add tokens to `KNOWN_TOKENS` just to query their balance — FastNEAR discovers them automatically once the DAO holds a positive balance. Add to `KNOWN_TOKENS` only when you want a curated icon/display name. Each entry carries `chainNetwork: "mainnet" | "testnet"`; `tokens.list` rejects known entries whose `chainNetwork` differs from the DAO's network and falls through to on-chain `ft_metadata`, so a mainnet DAO holding a contract literally named `wrap.testnet` shows the real mainnet metadata rather than leaking the testnet entry's "(testnet)" label. Limitation: FT holdings on `intents.near` (NEAR Intents multi-token contract) are not surfaced — if an agency needs that, add a sibling indexer call.

**Anchors.** `services/sputnik.ts.getDaoTokenIds`, `fetchAccountFtHoldings`, `getFtMetadata`; `services/tokens.ts.KNOWN_TOKENS`, `getTokenMetadata`; `tokens.list` handler in `api/src/index.ts` (the chainNetwork-vs-orgNetwork check).

### FT operations follow the owner's network, not the contract's account name

**Rule.** `getFtMetadata(contractId, ownerAccountId)` and `fetchFtBalance(ownerAccountId, contractId)` both pass the *owner* account to `rpcCall` for RPC URL inference. The contract account name is a string, not a network marker.

**Why.** Contract account suffixes look like network labels but aren't. A mainnet account can literally be named `wrap.testnet` (or `foo.testnet`, or any other `.testnet`-suffixed string); it's still a mainnet contract. A DAO can only hold tokens whose contracts live on its own network — so the owner's network is the only reliable signal for which RPC handles the call. Suffix-based routing of the contract account misrouted `ft_balance_of` to testnet for a mainnet DAO whose proposal history referenced `wrap.testnet`, surfacing as a phantom balance card on the treasury page.

**How to apply.** Every new FT view-call helper takes the owner account as a parameter and routes through it. The `ftMetadataCache` key is compound `${owner}::${contract}` so the same contract account name on two networks doesn't collide. Don't reintroduce contract-suffix routing for any chain call whose semantics are owned by an account on a different chain — when in doubt, route by the consumer's account.

**Anchors.** `services/sputnik.ts.getFtMetadata`, `fetchFtBalance`, `rpcCall`, `rpcUrlFor`.

### Budgets are positive; corrections come from named verbs

**Rule.** Three write paths into `budgets`: `adminCreate` (positive row), `adminDeallocate` (positive input; handler writes `-amount`, `relatedBudgetId` null), `adminTransfer` (paired `-from`/`+to` rows linked via `relatedBudgetId`). Contract's `baseAmount` validator is positive-only; handlers do the signing.

**Why.** UI forms take positive amounts and pick the verb at click time. Project budgets allowed to go negative — over-budget surfaces as warning, not blocked at API.

**How to apply.** New budget paths follow the verb pattern. Don't accept signed amounts at the contract.

**Anchors.** `budgets.adminCreate/adminDeallocate/adminTransfer` handlers.

### Single-tenant in v1

**Rule.** One agency, one DAO per deployment. Multi-tenant tooling (active-org switching, multiple DAOs in one deployment) deferred to v2.

**Why.** Multi-tenant adds active-org context to every gate and most queries; v1 brief is two weeks.

**How to apply.** Don't add `agencyId` columns or active-org middleware.

**Anchors.** Settings resolve per request from env (`api/src/lib/settings-defaults.ts`); `organizationId` on upstream `projects` rows equals the agency's `orgAccountId`.

### Public surface posture

**Rule.** Chain-derived read-only data MAY be public; locally-authored operational data is admin-only.

- **Chain-mirroring (public OK)**: DAO roles + members, treasury balances, Sputnik transfer proposals — anything queryable via NEAR RPC
- **Locally-authored (admin-only)**: budgets, billings, contributor records + compliance status, applications, project descriptions, project↔contributor assignments

**Why.** Hiding the UI doesn't hide chain data. Product posture is transparency, codified in the schema-defaulted tagline "Open Books · Open Source · Open Doors". Local-table reads have no chain equivalent.

**How to apply.** A new route that calls NEAR RPC and reshapes the result is fine public. A new route that selects from a local table is not. Public projects directory returns `projectWithNearn = publicProject.extend({ nearnListing })` where `publicProject = project.omit({ description: true })`; re-introducing `description` or adding a public single-project route requires revisiting this rule. Agencies that disagree delete or move the routes — they're template-excluded.

**Anchors.** Public surfaces: `team.list/getPublicSummary`, `treasury.getPublicBalances/getPublicSummary`, `proposals.list/getPublicSummary`, `agency.projects.list`.

### Agency table join shape

**Rule.** Project-scoped tables (`budgets`, `billings`, `projectContributors`, `listings`) reference upstream's project rows via a plain-text `projectId` column — no FK, since the projects live in another plugin's schema. Referential integrity is app-layer: handlers verify membership via `requireProjectInOrg(projectId, orgAccountId)` or by joining against `fetchOrgProjects(orgAccountId)`. Agency-scoped tables (`applications`, `contributors`) have no `projectId` — `applications` is a public-inquiry table; `contributors` links to projects via `projectContributors` (composite PK `(projectId, contributorId)`).

**Why.** Project rows moved to upstream's `projects` plugin; FKs across plugin-owned schemas aren't possible. App-layer integrity is the trade-off for indexing rather than authoring projects locally.

**How to apply.** New project-scoped tables: `projectId text NOT NULL` (no `.references(...)`). Gate writes with `requireProjectInOrg`. Composite-PK join tables for many-to-many. For agency-wide reads filtered by project, batch-list upstream projects once (`fetchOrgProjects`) and filter local rows by the resulting id set.

**Anchors.** `api/src/db/schema.ts`; `fetchOrgProjects` / `requireProjectInOrg` helpers in `api/src/index.ts`.

### Billings are 1:1 with Sputnik DAO Transfer proposals

**Rule.** Every contributor payment is a DAO proposal. `billings.proposalId` is `NOT NULL UNIQUE` (`billings_proposal_unique`). No off-chain billing. The billings row is a slim project-scoping wrapper around an on-chain proposal. Status, recipient, token, and amount all come from chain.

**Why.** Chain is the single source of truth. Local lifecycle column = parallel state machine = reconciliation bugs.

**How to apply.**

- **At create** (`billings.adminCreate`): operator inputs `projectId` + `proposalId` (+ optional `contributorId` override + optional `note`). Handler fetches via `getProposal`, rejects non-`Transfer` kinds with `BAD_REQUEST`, derives `tokenId` / `amount` / `contributorId` from the proposal payload (`receiver_id` matched against `contributors.nearAccountId`).
- **At read** (`adminList`, `computeBudget`): rows enriched with `getProposal(daoAccountId, proposalId).status` — seven-state Sputnik enum (`InProgress` / `Approved` / `Rejected` / `Removed` / `Expired` / `Moved` / `Failed`). `InProgress` cached 15s in-memory; absorbing states cached indefinitely in the `proposals` table. Per-row Trezu deep-link: `https://trezu.app/<daoAccountId>/requests/<proposalId>`.
- **Budget rollup** (slices model): `allocated` / `committed` / `paid` / `remaining` are disjoint per project and sum to `budgeted`. `paid` = Sputnik Transfer `status === "Approved"`. `committed` = Sputnik Transfer `status === "InProgress"` + listings with `isWinnersAnnounced=true` where no non-failed billing exists for the same `(projectId, tokenId)`. `allocated` = the project's active listing `rewardAmount` where `isPublished=true AND isArchived=false AND isWinnersAnnounced=false` — NEARN-source wins over internal-source if both exist on the same project; 0 if no active listing. `remaining` = `budgeted − allocated − committed − paid`. Terminal-fail proposals (`Rejected`/`Removed`/`Expired`/`Moved`/`Failed`), unpublished listings (`isPublished=false`), and archived listings (`isArchived=true`) are excluded from all source columns. Archived projects (`status="archived"`) are also excluded at the rollup-call boundary in `treasury.getRollups` — defense-in-depth against listing-cascade divergence; `projects.adminUpdate` cascades the project status to its listings' `isArchived` field, but the rollup filter is the durable guarantee. NEARN's `status` field is uniformly `"OPEN"` and not load-bearing; `deadline` is operationally informative but accounting-irrelevant. Agency rollup adds `available = balance − (budgeted − paid)` (treasury slack). Math lives in `services/rollups.ts.rollupForToken`; both `computeBudget` (per-project) and `treasury.getRollups` (agency) consume it. See SPEC → Target rollup model.
- **Never**: reintroduce a local `status` column; add `billings.adminUpdate`; accept operator-typed token/amount fields.

**Anchors.** `billings` table and `proposals` cache table in `api/src/db/schema.ts`; `billings.adminCreate/adminList` and `computeBudget` in `api/src/index.ts`.

### Effect usage policy: at the boundary, plain async inside

**Rule.** `Effect.gen` / `Effect.promise` in `createPlugin`'s `initialize` / `shutdown` hooks (framework boundary). Inside services and route handlers: plain `async`/`Promise` with `Map`-based caches.

**Why.** Lifting services into Effect-Tag layers adds ceremony without architectural justification at this scale.

**How to apply.** Don't add new Effect-Tag layers unless cache + retry + typed errors form a justified unit OR testability via Tag swap is needed.

**Anchors.** `createPlugin` in `api/src/index.ts`; service files in `api/src/services/`.

### u128-shaped fields coerce with String(...)

**Rule.** At the deserialization boundary, coerce u128-shaped fields (`amount`, `balance`, `share_price`, vote counts, bond, gas) with `String(raw.field ?? "0")`. Never use `parseInt` / `parseFloat` / `Number(...)` on a u128.

**Why.** Older Sputnik deployments JSON-encode `U128` as numbers; newer ones as strings. A tight `z.string().parse()` throws silently → query resolves to undefined → UI shows empty state while `curl` against the same RPC returns rows. Downstream `BigInt(value)` is safe once normalized.

**How to apply.** Apply to every new contract view that returns a u128-shaped field. Don't tighten the zod schema for these.

**Anchors.** `parseProposal`, FT/NEAR balance fetchers in `services/sputnik.ts`.

### Agency-identity defaults

**Rule.** Brand identity (`name`, `headline`, `tagline`) is hardcoded in `settings-defaults.ts` — invariant for this deployment, NOT env-overridable, NOT in the settings table. The active `orgAccountId` resolves from env per request (`AGENCY_ORG_ACCOUNT_MAINNET` / `AGENCY_ORG_ACCOUNT_TESTNET`); operational identity (`nearnAccountId`, `websiteUrl`, `docsUrl`, `description`, `contactEmail`) resolves DB → env → hardcoded per request, with the `agency.settings` row keyed by `orgAccountId` and editable at `/admin/settings`. Env-var fallbacks for editable fields: `AGENCY_NEARN_ACCOUNT`, `AGENCY_WEBSITE_URL`, `AGENCY_DOCS_URL`, `AGENCY_DESCRIPTION`, `AGENCY_CONTACT_EMAIL`. Role-name overrides (`defaultAdminRoleName` / `defaultApproverRoleName` / `defaultRequestorRoleName`) read `AGENCY_ADMIN_ROLE` / `AGENCY_APPROVER_ROLE` / `AGENCY_REQUESTOR_ROLE`, hardcoded fallback `Admin` / `Approver` / `Requestor` — env-only, never in the settings table (self-lockout risk).

**Why.** A fresh deploy demos meaningfully against the maintainer's DAO with zero config. Brand strings hardcoded keep the codebase honest about its identity claim — agencies rebrand by editing `settings-defaults.ts`, not by setting env vars. Operational identity is admin-editable via `/admin/settings` (NEARN handle, urls, description, contact email) so a deployed agency can fix or evolve those fields without redeploy. The active DAO (`orgAccountId`) stays env-only — admin can't repoint the dashboard at a different DAO from inside the dashboard, avoiding the self-lockout risk. Role names stay env-only because changing them while admin is irreversible if the new name doesn't have a member.

**How to apply.** Don't hardcode `MultiAgency` strings on public surfaces; read from `settings.getPublic`. For new brand-identity fields, hardcode in `settings-defaults.ts`. For new operational-identity fields, add an env-override path with a null/empty default.

**Anchors.** `HARDCODED_*` constants + per-field `default*()` helpers in `api/src/lib/settings-defaults.ts`; `FALLBACK` in `ui/src/routes/_layout/index.tsx`.

### Multi-network resolution

**Rule.** The dashboard observes one network per request, resolved by `getNetwork(reqHeaders)` in `api/src/lib/network.ts`:

1. **Pinned mode** — if `NEAR_NETWORK` env is set (`mainnet` or `testnet`), every request returns that network. NetworkToggle UI hides. Single-network deployments.
2. **Free mode** — `NEAR_NETWORK` unset. Client carries the active network via the `X-Network` request header set by `apiClient.fetch`. The header value comes from `getNetwork()` in `ui/src/lib/auth.ts`, which reads `?network=` URL search param (canonical, set by `setNetwork` on toggle) → `localStorage["agency_network"]` (next-session memory) → runtime config → suffix-of-account. Server-side `getNetwork(reqHeaders)` reads the header. Anonymous visitors toggle via NetworkToggle; signed-in users see a read-only badge (toggle hidden, current network derived from URL/localStorage).

Public surfaces (`/treasury`, `/team`, etc.) render the resolved view network's data per-visitor. Admin gates run against the resolved network's DAO. No cookies — privacy-friendly, no GDPR banner concern.

**SSR first-paint limitation (v0.1).** SSR loaders run without URL access and default to mainnet's cache; client hydration with a different network refetches via header (one-time flicker per page load for non-mainnet visitors). Loader-hit queries in `ui/src/lib/queries.ts` include `getNetwork()` in their queryKey so SSR-cached mainnet data doesn't satisfy a testnet client request — cache miss forces the refetch. Eliminating the flicker requires upstream `everything-dev` support for a per-request `apiClient` factory in `RenderOptions` (tracked as Option α in `plans/v1.md`).

**Why.** Same deployment serves both networks: anonymous testnet-curious visitors can browse testnet data via toggle; the maintainer's testing workflow toggles before signing in with the matching network's wallet. Pinned mode lets single-network operators opt out — set `NEAR_NETWORK` in env, toggle disappears, every visitor sees that one network.

**How to apply.** Server-side: call `getOrgAccountId(context.reqHeaders)` for every handler that needs the active org. Never read `NEAR_NETWORK` env directly in service code (`defaultOrgAccount(network)` + `pinnedNetwork()` in `api/src/lib/default-org-account.ts` are the only legitimate consumers). For services like `rpcUrlFor` and `isNearnAvailable`, derive from the passed `orgAccountId`'s suffix via `networkOf` — account-driven, not env-driven. Client-side: NetworkToggle subscribes to `settings.getPublic.networkPinned` and hides when pinned; `setNetwork` (the toggle's click handler) writes localStorage + rewrites URL with `?network=` + full-reloads so SSR re-runs and queryClient rebuilds with the new network in queryKeys.

**Anchors.** `getNetwork`, `NETWORK_HEADER` in `api/src/lib/network.ts`; `getOrgAccountId` in `api/src/index.ts`; `defaultOrgAccount(network)`, `pinnedNetwork()` in `api/src/lib/default-org-account.ts`; `setNetwork`, `getNetwork` in `ui/src/lib/auth.ts`; `createApiClient` + `detectClientNetwork` (per-fetch header injection) in `ui/src/lib/api.ts`; loader-hit queryOptions with network-keyed cache in `ui/src/lib/queries.ts`; `<NetworkToggle>` in `ui/src/components/network-toggle.tsx`; `networkPinned` field on `settings.getPublic` output.

### Default org account

**Rule.** `orgAccountId` is deploy-time config — handlers resolve it from env via `defaultOrgAccount(network)` per request. The function is in `api/src/lib/default-org-account.ts` — `NEAR_NETWORK === "testnet"` selects `AGENCY_ORG_ACCOUNT_TESTNET` (default `multiagency.sputnikv2.testnet`); else `AGENCY_ORG_ACCOUNT_MAINNET` (default `multiagency.sputnik-dao.near`). The `agency.settings` table is keyed BY `orgAccountId` (each DAO carries its own per-DAO operational identity row), but the *active* `orgAccountId` itself doesn't come from the DB — it resolves env-only, so changing the dashboard's target DAO is an env edit + restart, not a settings UI save. `userInRole` short-circuits for non-DAO accounts to `accountId === orgAccountId` (self-ownership), so any NEAR account (not just Sputnik DAOs) can be the org.

**Why.** A fresh deploy demos meaningfully against the maintainer's DAO without any pre-seed write. Lazy resolution means `.env` edits to `NEAR_NETWORK` / the per-network vars take effect on the next request, not just first boot. The settings UI at `/admin/settings` is multi-tenant native: rows are keyed by `orgAccountId`, so each DAO carries its own row independent of others; `orgAccountId` itself is read-only in the UI (env-driven, change-by-restart) so admin can't accidentally lock themselves out by repointing at a DAO where they aren't admin; role names stay out of the UI (env-only — irreversible if the new name has no member).

**How to apply.** Set `NEAR_NETWORK` and override `AGENCY_ORG_ACCOUNT_MAINNET` or `AGENCY_ORG_ACCOUNT_TESTNET` before deploy. Agencies instantiated via `bunx everything-dev init` get this baked in. Operational identity (`nearnAccountId`, `websiteUrl`, `docsUrl`, `description`, `contactEmail`) is admin-editable at `/admin/settings` with env-var fallbacks (`AGENCY_NEARN_ACCOUNT`, `AGENCY_WEBSITE_URL`, `AGENCY_DOCS_URL`, `AGENCY_DESCRIPTION`, `AGENCY_CONTACT_EMAIL`). The active `orgAccountId` resolves from env only — to repoint at a different DAO, edit `AGENCY_ORG_ACCOUNT_MAINNET|TESTNET` and restart. Role-name overrides via `AGENCY_ADMIN_ROLE`, `AGENCY_APPROVER_ROLE`, `AGENCY_REQUESTOR_ROLE` — env-only, never settings UI. Brand identity (name, headline, tagline) is hardcoded — edit `settings-defaults.ts` to rebrand. Each editable field resolves per request through `getResolvedPublicSettings` (DB → env → hardcoded).

**Anchors.** `defaultOrgAccount()` in `api/src/lib/default-org-account.ts`; `defaultPublicSettings()` + per-field `default*()` helpers in `api/src/lib/settings-defaults.ts`; `settings.getPublic` handler in `api/src/index.ts`; `userInRole` short-circuit in `api/src/services/sputnik.ts`.

### Chain position: downstream of everything.dev, upstream of agency deployments

**Rule.** `bos.config.json`'s `extends: bos://dev.everything.near/everything.dev` extends the framework; `bos publish --deploy` publishes our config for downstream agency deployments to extend.

**Why.** Three-tier propagation: upstream framework → this template → downstream agency deployments.

**How to apply.** Pull framework updates via `bos upgrade` (bumps `everything-dev` and `every-plugin`, then runs sync); publish downstream via `bos publish --deploy`. Operational identity (DAO account, NEARN slug, urls, description, contactEmail) is admin-editable at `/admin/settings` after deploy, with env fallbacks at deploy time; brand identity (name, headline, tagline) is hardcoded in `settings-defaults.ts` — edit that file to rebrand. `bos init` ships scaffolding, not deployment-specific values.

**Anchors.** `bos.config.json`.

### Public docs registered in docs-registry

**Rule.** The `/docs` route iterates `ui/src/lib/docs-registry.ts`. Each entry's `source` field picks one of two served paths:
- `source: "skills"` → `ui/public/skills/<slug>.md` (mirrors `.opencode/skills/<slug>/SKILL.md` verbatim — update both files)
- `source: "docs"` → `ui/public/docs/<slug>.md` (template-authored, no upstream mirror — agency-specific operating-model content like entity, contributors, services-agreement, work-order)

**Why.** Single registry is source of truth for `/docs` index and detail pages.

**How to apply.** Don't add a third DOCS array elsewhere. Keep `.opencode/skills/` and `ui/public/skills/` in sync for mirrored entries.

**Anchors.** `ui/src/lib/docs-registry.ts`; `_layout/docs/index.tsx`, `_layout/docs/$slug.tsx`.

