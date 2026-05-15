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

If missing, the dashboard ships pointed at `PLACEHOLDER.sputnik-dao.near` (a non-routable placeholder). Admin surfaces stay locked until you repoint — see [Recover from missing env var](#recover-from-missing-env-var) below.

Optional notification channels for new-application submissions (`/apply`, `/register`, `/contact`) — each no-ops if unset:

```bash
APPLICATIONS_WEBHOOK_URL=  # Discord/Slack/Zapier incoming webhook
RESEND_API_KEY=            # Resend API token
NOTIFY_FROM_EMAIL=         # sender on a Resend-verified domain; recipient is agency_settings.contactEmail
```

### 2. Deploy

```bash
bun install
bun run db:migrate
bos publish --deploy
```

Verify: visit the deployed URL, sign in with NEAR (using an account that's Admin on your DAO), confirm the admin navigation appears in the header.

### 3. Recover from missing env var

When the `AGENCY_DAO_ACCOUNT` env var wasn't set at deploy time, the dashboard ships pointed at the placeholder DAO. Three recovery paths:

- **Bootstrap claim flow (recommended)** — sign in with a NEAR account that's Admin on your destination DAO. Because `agency_settings.daoAccountId` still equals the placeholder, the `_authenticated/_configured.tsx` layout redirects all admin routes to `/settings`, which renders a "Set up your worksite" affordance. Submit your DAO account ID (and admin role name override if your DAO doesn't use `Admin`). The handler verifies you're admin on the destination DAO via `userInRole` (`get_policy` over NEAR RPC) before writing the row. After claim, normal admin gating applies and the affordance disappears; further calls reject with BAD_REQUEST.
- **Redeploy with the env var set** — clean state; useful when you can re-trigger deployment with the right env injected.
- **Direct DB edit** — `UPDATE agency_settings SET dao_account_id = '<your-dao>.sputnik-dao.near' WHERE id = 'default';` Last-resort emergency option when neither claim flow nor redeploy is available.

## Configure identity

Sign in as a NEAR account that's Admin in your DAO. Visit `/settings`.

Required:
- **Agency name** — replaces "MultiAgency" placeholder on the landing
- **DAO account** — should already be set from `AGENCY_DAO_ACCOUNT` env

Recommended:
- **Headline** — big poster line under the agency wordmark (default: "Open Books · Open Source · Open Doors")
- **Tagline** — short descriptor used as the browser tab / share title; not displayed on the landing (default: "The future of work is near…")
- **Contact email** — powers the `/contact` page's mailto CTA (default: "multiagentic@gmail.com")
- **Website URL** — your standalone marketing site if you have one
- **Docs URL** — your external docs site (appears as a card in the landing's Docs section)
- **NEARN sponsor slug** — enables "unlinked bounties" surfacing in the Manage Projects section on `/work`

Optional (advanced):
- **Admin / Approver / Requestor role-name overrides** — only needed if your DAO uses non-Trezu role names (e.g., Sputnik's `default_policy()` uses `all`/`council`)
- **Description, metadata** — long-form fields for internal use

Save. The landing page reflects changes on next visit (5-minute query stale time).

## After setup — operating surfaces

Day-to-day operations happen at:

Admin surfaces are sections embedded in the public routes — they appear once you sign in with the right DAO role.

| Surface | What it does |
|---|---|
| `/work` | Public projects directory; operators get an embedded Manage Projects section — create/edit projects, link to NEARN bounties, surface unlinked bounties |
| `/admin/projects/$slug` | Per-project budget rollup, contributors, NEARN snapshot |
| `/team` | DAO roles, members, and permissions (read from chain); admins get embedded Contributors (vendor records — onboarding status, payment terms) and Applications review (interest captures from `/apply` + `/register` + `/contact`) sections |
| `/treasury` | Treasury balances and recent activity; operators get an embedded Allocations section — allocate treasury into project budgets, transfer between projects, agency audit log |
| `/payouts` | DAO proposal / payout history; operators get an embedded Billings Audit section (record payments tied to Sputnik DAO proposals) and a proposals map |

Detailed playbooks for each surface live at [docs.multiagency.ai](https://docs.multiagency.ai) (planned).

## Re-deploying after a schema reset

When a migration history is squashed (`api/src/db/migrations/` rewritten), the production DB needs to be wiped — the runtime migrator skips already-applied hashes, so a new initial migration against an existing schema would `CREATE TABLE` against tables that already exist and fail. Sequence:

1. `bun run deploy` — uploads new bundles; production still serving the old bundle URLs
2. Compute SHA-384 of the new UI bundle's `remoteEntry.js` and write it to `bos.config.json` `app.ui.integrity` (the deploy tool's SRI step strips it; absent integrity drops `crossOrigin="anonymous"` on the script tag, breaking the Module Federation container handshake — host retries 10x then logs "Container not found")
3. Wipe the prod DB from the hosting provider's postgres console:
   ```sql
   DROP SCHEMA IF EXISTS drizzle CASCADE;
   DROP SCHEMA public CASCADE;
   CREATE SCHEMA public;
   ```
4. `bos publish` — registry cutover; new bundles activate; the API plugin's `initialize` runs the migrator against the empty DB and seeds `agency_settings` from `AGENCY_DAO_ACCOUNT`
5. Wait ~100s for propagation; smoke-test the cold-visitor + operator flows

The wipe step in (3) drops both schemas because drizzle-kit (local dev) tracks in `drizzle.__drizzle_migrations` and the runtime migrator tracks in the same location — wiping public alone leaves stale hashes.

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

**`/work` shows no projects.**
Either no projects exist yet (create one in the Manage Projects section on `/work`) or all projects are private (`visibility=private` is admin-only).

**NEARN listing fetch fails on `/work`.**
NEARN's listing API is undocumented and unversioned; transient failures are expected. The card degrades to local title + status. If persistent, check NEARN status.

**Treasury balance shows "unavailable".**
NEAR RPC failure. The dashboard fails closed (no retry, no stale cache). Wait and retry; if persistent, check `near.org` for chain status or your RPC provider.

For deeper troubleshooting and operational patterns, see [docs.multiagency.ai](https://docs.multiagency.ai) (planned).
