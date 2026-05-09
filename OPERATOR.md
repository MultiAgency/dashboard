# Deploying Your Agency

Walks a fork operator from cloned repo to deployed, configured agency dashboard.

For development workflow (`bun run dev`, hot-reload, etc.), see [README.md](./README.md).
For the canonical operator manual (day-to-day operations, advanced configuration, troubleshooting), see [docs.multiagency.ai](https://docs.multiagency.ai) (planned).

## Prerequisites

1. **NEAR account** — the account you'll sign in with. Must be added as Admin in the DAO (step 2).
2. **Sputnik DAO contract on NEAR** — your treasury. Create one via [AstroDAO](https://app.astrodao.com/) or [Trezu](https://trezu.app/). Add your NEAR account to the Admin role in the DAO policy.
3. **NEARN sponsor account** — for listing opportunities and paying contributors. Sign up at [nearn.io](https://nearn.io/) and configure the sponsor profile that connects to your DAO.
4. **Registered legal entity** — LLC, Ltd, GmbH, or your jurisdiction's equivalent. The dashboard provides operating infrastructure; the entity provides the legal wrapper.

## First-time deployment

### 1. Configure your DAO account

Set the `AGENCY_DAO_ACCOUNT` environment variable to your Sputnik DAO contract before deploying:

```bash
AGENCY_DAO_ACCOUNT=<your-dao>.sputnik-dao.near
```

Add this to your deployment environment (hosting provider's env-var settings, `.env` file, etc.) before running `bos publish --deploy`.

If missing, the dashboard ships pointed at `multiagency.sputnik-dao.near` (the maintainer's DAO). Admin surfaces will return FORBIDDEN until you repoint — see [Recover from missing env var](#recover-from-missing-env-var) below.

### 2. Deploy

```bash
bun install
bun run db:migrate
bos publish --deploy
```

Verify: visit the deployed URL, sign in with NEAR (using an account that's Admin on your DAO), confirm the admin navigation appears in the sidebar.

### 3. Recover from missing env var

When the `AGENCY_DAO_ACCOUNT` env var wasn't set at deploy time, the dashboard ships pointed at the placeholder DAO. Three recovery paths:

- **Bootstrap claim flow (recommended)** — sign in with a NEAR account that's Admin on your destination DAO. Because `agency_settings.daoAccountId` still equals the placeholder, the `_authenticated/_configured.tsx` layout redirects all admin routes to `/home`, which renders a "Set up your agency" affordance. Submit your DAO account ID (and admin role name override if your DAO doesn't use `Admin`). The handler verifies you're admin on the destination DAO via `userInRole` (`get_policy` over NEAR RPC) before writing the row. After claim, normal admin gating applies and the affordance disappears; further calls reject with BAD_REQUEST.
- **Redeploy with the env var set** — clean state; useful when you can re-trigger deployment with the right env injected.
- **Direct DB edit** — `UPDATE agency_settings SET dao_account_id = '<your-dao>.sputnik-dao.near' WHERE id = 'default';` Last-resort emergency option when neither claim flow nor redeploy is available.

## Configure identity

Sign in as a NEAR account that's Admin in your DAO. Visit `/settings`.

Required:
- **Agency name** — replaces "MultiAgency" placeholder on the landing
- **DAO account** — should already be set from `AGENCY_DAO_ACCOUNT` env

Recommended:
- **Headline** — large H2 on the landing (default: "Always building. Always open.")
- **Tagline** — subtitle below the headline
- **Contact email** — surfaces in the landing footer
- **Website URL** — your standalone marketing site if you have one
- **Docs URL** — your external docs site (appears as a card in the landing's Docs section)
- **NEARN sponsor slug** — enables "unlinked bounties" surfacing on `/admin/projects`

Optional (advanced):
- **Admin / Approver / Requestor role-name overrides** — only needed if your DAO uses non-Trezu role names (e.g., Sputnik's `default_policy()` uses `all`/`council`)
- **Description, metadata** — long-form fields for internal use

Save. The landing page reflects changes on next visit (5-minute query stale time).

## After setup — operating surfaces

Day-to-day operations happen at:

| Surface | What it does |
|---|---|
| `/home` | Workspace + your assigned projects |
| `/admin/projects` | Create/edit projects, link to NEARN bounties, surface unlinked bounties |
| `/admin/projects/$slug` | Per-project budget rollup, contributors, NEARN snapshot |
| `/admin/contributors` | Agency-internal vendor records (compliance docs, payment terms) |
| `/admin/allocations` | Allocate treasury into project budgets, transfer between projects, agency audit log |
| `/admin/billings` | Record payments tied to Sputnik DAO proposals |
| `/admin/applications` | Review interest captures from `/apply` |
| `/admin/proposals` | Observe DAO proposal activity (read-only; vote via Trezu) |
| `/team` | DAO roles, members, and permissions (read from chain) |

Detailed playbooks for each surface live at [docs.multiagency.ai](https://docs.multiagency.ai) (planned).

## Customizing visual identity

Beyond `/settings`, fork-owned static assets:

- `ui/public/manifest.json` — PWA manifest (browser tab name, install prompt)
- `ui/public/icon.svg`, `ui/public/favicon.ico`, etc. — branding assets
- `ui/public/skills/*.md` — skill files served at `/skills/*.md` for visitor reference (linked from landing's Docs section)

Replace these files in your fork to match your brand. Repository-tracked; no settings UI for these.

## Troubleshooting

**Admin nav doesn't appear after sign-in.**
You're signed in but not admin on the configured DAO. Verify:
1. `agency_settings.dao_account_id` matches your DAO
2. Your NEAR account is in the Admin role on that DAO's `get_policy`

**`/projects` shows no projects.**
Either no projects exist yet (create one at `/admin/projects`) or all projects are private (`visibility=private` is admin-only).

**NEARN listing fetch fails on `/projects`.**
NEARN's listing API is undocumented and unversioned; transient failures are expected. The card degrades to local title + status. If persistent, check NEARN status.

**Treasury balance shows "unavailable".**
NEAR RPC failure. The dashboard fails closed (no retry, no stale cache). Wait and retry; if persistent, check `near.org` for chain status or your RPC provider.

For deeper troubleshooting and operational patterns, see [docs.multiagency.ai](https://docs.multiagency.ai) (planned).
