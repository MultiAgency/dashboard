# Deploying Your Agency

Walks an agency operator from initialized scaffold to deployed, configured agency dashboard.

For development workflow (`bun run dev`, hot-reload, etc.), see [README.md](./README.md).
For the canonical operator manual (day-to-day operations, advanced configuration, troubleshooting), see [docs.multiagency.ai](https://docs.multiagency.ai) (planned).

## Prerequisites

1. **NEAR account** — the account you'll sign in with. Must be added as Admin in the DAO (step 2).
2. **Sputnik DAO contract on NEAR** — your treasury. Create one via [AstroDAO](https://app.astrodao.com/) or [Trezu](https://trezu.app/). Add your NEAR account to the Admin role in the DAO policy.
3. **NEARN sponsor account** — for listing opportunities and paying contributors. Sign up at [nearn.io](https://nearn.io/) and configure the sponsor profile that connects to your DAO.
4. **Registered legal entity** — LLC, Ltd, GmbH, or your jurisdiction's equivalent. The dashboard provides operating infrastructure; the entity provides the legal wrapper.

## First-time deployment

### 1. Configure your DAO account

Override the per-network default for your target network before deploying:

```bash
AGENCY_ORG_ACCOUNT_MAINNET=<your-dao>.sputnik-dao.near
# or, for testnet:
NEAR_NETWORK=testnet
AGENCY_ORG_ACCOUNT_TESTNET=<your-dao>.sputnikv2.testnet
```

Add to your deployment environment (hosting provider's env-var settings, `.env` file, etc.) before running `bos publish --deploy`. `NEAR_NETWORK` picks which per-network var the runtime fallback uses; mainnet is the default when unset.

If none are set, the dashboard renders against `multiagency.sputnik-dao.near` (the maintainer's DAO) and shows live data immediately. To take over the deployment as your own agency, configure after deploy — see [Take over a fresh deployment](#3-take-over-a-fresh-deployment) below.

Optional notification channels for new-application submissions (`/apply`, `/register`, `/contact`) — each no-ops if unset:

```bash
APPLICATIONS_WEBHOOK_URL=  # Discord/Slack/Zapier incoming webhook
RESEND_API_KEY=            # Resend API token
NOTIFY_FROM_EMAIL=         # sender on a Resend-verified domain; recipient is the hardcoded `HARDCODED_CONTACT_EMAIL` in `api/src/lib/settings-defaults.ts`
```

### 2. Deploy

```bash
bun install
bun run db:migrate
bos publish --deploy
```

Verify: visit the deployed URL, sign in with NEAR (using an account that's Admin on your DAO), confirm the admin navigation appears in the header.

#### Deployment notes

**Required database URLs (all three or routes 404).** The API, auth, and projects plugins each connect to Postgres at boot. If any of `API_DATABASE_URL`, `AUTH_DATABASE_URL`, or `PROJECTS_DATABASE_URL` is unset or wrong, the corresponding plugin fails to mount and the host's SSR can't render — every non-root path (`/work`, `/team`, `/treasury`, etc.) returns 404 from the document fetch (not from a missing route inside the SPA, from the server). Symptom: `curl https://<deployment>/work` returns 404 while `curl https://<deployment>/` returns 200. Verify all three are set and reachable before announcing the deploy. The Dockerfile's `CMD` is `bun run start` — it does NOT run `bun run db:migrate`, so apply schema migrations via a Railway pre-deploy hook (or run them manually against the prod DB) whenever you ship a commit that adds a migration.

**Legacy env-var names.** Earlier scaffolds used `AGENCY_DAO_ACCOUNT` for the org/DAO pointer. The current code reads `AGENCY_ORG_ACCOUNT_MAINNET` / `AGENCY_ORG_ACCOUNT_TESTNET` (per `api/src/lib/default-org-account.ts`). If your Railway environment still has `AGENCY_DAO_ACCOUNT` set, it's dead config — remove it.

**Single-network agencies must override both env vars (or pin).** If you operate on a single network and leave `NEAR_NETWORK` unset (free mode), set both `AGENCY_ORG_ACCOUNT_MAINNET` and `AGENCY_ORG_ACCOUNT_TESTNET` to your DAO — or duplicates of it. Otherwise, visitors toggling to the network you don't operate on observe the maintainer's testnet/mainnet DAO. The simpler pattern: set `NEAR_NETWORK=mainnet` (or `=testnet`) to pin the dashboard to your single network, hiding the toggle entirely.

**CDN/edge cache.** The dashboard serves per-visitor data based on the `agency_view_network` cookie. If your deployment is behind a CDN (Cloudflare, Fastly, Vercel Edge, etc.), configure it to either (a) not cache `/api/*` responses, or (b) include `Cookie` in the cache key. Without this, visitors with different cookies may receive each other's cached responses — silently breaking multi-network. The application doesn't set `Cache-Control` or `Vary: Cookie` itself (the oRPC adapter doesn't expose a response-headers hook from the plugin); this is an edge-layer responsibility. Railway origin without a CDN in front is unaffected.

### 3. Take over a fresh deployment

A fresh deploy renders against `multiagency.sputnik-dao.near` and shows live data immediately. To make the deployment your own agency, set `AGENCY_ORG_ACCOUNT_MAINNET=your-dao.sputnik-dao.near` (or `_TESTNET` with `NEAR_NETWORK=testnet`) in your deploy environment and redeploy. The runtime fallback resolves to your DAO on every request. No DB row is created at boot.

## Configure identity

**Brand identity is hardcoded.** `name`, `headline`, `tagline`, and `contactEmail` are maintainer-branded invariants in `api/src/lib/settings-defaults.ts` — env vars do NOT override them. Agencies that need to rebrand edit those constants directly.

**Operational identity is env-overridable.** Set these in your hosting provider; each resolves per request, so `.env` edits take effect on the next API call after a restart:

- `AGENCY_WEBSITE_URL` — your standalone marketing site (stored; not currently rendered in v1)
- `AGENCY_DOCS_URL` — your external docs site (renders as a `docs site →` link)
- `AGENCY_DESCRIPTION` — long-form description (rendered under the headline on the landing when set; also surfaced as the `<meta name="description">` for search / social previews)
- `AGENCY_NEARN_ACCOUNT` — NEARN sponsor slug; enables unlinked-bounties surfacing on `/work`

**DAO role-name overrides.** If your DAO uses non-standard role names, override:

- `AGENCY_ADMIN_ROLE` (default `Admin`)
- `AGENCY_APPROVER_ROLE` (default `Approver`)
- `AGENCY_REQUESTOR_ROLE` (default `Requestor`)

Blank values fall through to defaults; non-blank wins. See `api/src/lib/settings-defaults.ts` for the resolver. Multi-tenant per-user settings is v2.

## Network & infrastructure env

Set these in your hosting provider (they are not in the synced `.env.example`):

- `AGENCY_ORG_ACCOUNT_MAINNET` / `AGENCY_ORG_ACCOUNT_TESTNET` — the DAO (or any NEAR account) that is the agency's identity + treasury per network. DAO features require a Sputnik subaccount (`.sputnik-dao.near` / `.sputnikv2.testnet`). Read-only in `/admin/settings`; change here and restart.
- `NEAR_NETWORK` — pin to a single network (`mainnet`/`testnet`), which hides the NetworkToggle so every visitor sees that network. Leave unset for multi-network mode (visitors toggle).
- `NEAR_RPC_URL_MAINNET` / `NEAR_RPC_URL_TESTNET` — optional private-RPC overrides; public FastNEAR endpoints route correctly per-account by default.
- `FASTNEAR_API_KEY` — lifts rate limits on FastNEAR RPC + REST; sent as Bearer auth only when the destination host is FastNEAR.

## After setup — operating surfaces

Day-to-day operations happen at:

Admin surfaces are sections embedded in the public routes — they appear once you sign in with the right DAO role.

| Surface | What it does |
|---|---|
| `/work` | Public projects directory; operators get an embedded Manage Projects section — create/edit projects, link to NEARN bounties, surface unlinked bounties |
| `/admin/projects/$slug` | Per-project budget rollup, contributors, NEARN snapshot |
| `/admin/settings` | Admin-only configuration of operational identity: NEARN account, website/docs URLs, description, contact email. Rows are keyed by `orgAccountId` (the active DAO is read-only here — env-driven; change by editing `AGENCY_ORG_ACCOUNT_MAINNET\|TESTNET` and restarting). Brand identity (name/headline/tagline) and role names stay env-only / hardcoded — not editable here. |
| `/team` | DAO roles, members, and permissions (read from chain); admins get embedded Contributors (vendor records — onboarding status, payment terms) and Applications review (interest captures from `/apply` + `/register` + `/contact`) sections |
| `/treasury` | Treasury balances and DAO proposal / payout history (`payouts` tab); operators get embedded Budgets, Recent activity, Proposals map, and Billings Audit tabs — budget treasury into projects, record payments tied to Sputnik DAO proposals, agency audit log |

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
4. `bos publish` — registry cutover; new bundles activate; the API plugin's `initialize` runs the migrator against the empty DB. Operational identity (NEARN account, urls, description, contact email) reads the `agency.settings` row (keyed by `orgAccountId`) when present, else falls through to env / hardcoded — so an empty DB renders correctly with no manual seed.
5. Wait ~100s for propagation; smoke-test the cold-visitor + operator flows

The wipe step in (3) drops both schemas because drizzle-kit (local dev) tracks in `drizzle.__drizzle_migrations` and the runtime migrator tracks in the same location — wiping public alone leaves stale hashes.

## Customizing visual identity

Beyond env vars, agency-owned static assets:

- `ui/public/manifest.json` — PWA manifest (browser tab name, install prompt)
- `ui/public/icon.svg`, `ui/public/favicon.ico`, etc. — branding assets
- `ui/public/skills/*.md` — skill files served at `/skills/*.md` for visitor reference (linked from landing's Docs section)

Replace these files in your deployment to match your brand. Repository-tracked; no settings UI for these.

## Troubleshooting

**Admin nav doesn't appear after sign-in.**
You're signed in but not admin on the configured DAO. Verify:
1. `AGENCY_ORG_ACCOUNT_MAINNET` (or `_TESTNET` with `NEAR_NETWORK=testnet`) env var points at your DAO
2. Your NEAR account is in the Admin role on that DAO's `get_policy`

**`/work` shows no projects.**
Either no projects exist yet (create one in the Manage Projects section on `/work`) or all projects are private (`visibility=private` is admin-only).

**NEARN listing fetch fails on `/work`.**
NEARN's listing API is undocumented and unversioned; transient failures are expected. The card degrades to local title + status. If persistent, check NEARN status.

**Treasury balance shows "unavailable".**
NEAR RPC failure. The dashboard fails closed (no retry, no stale cache). Wait and retry; if persistent, check `near.org` for chain status or your RPC provider.

For deeper troubleshooting and operational patterns, see [docs.multiagency.ai](https://docs.multiagency.ai) (planned).
