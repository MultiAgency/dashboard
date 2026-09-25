# Scripts

## Organization cleanup

`bun run db:cleanup:organizations` prepares production data for "Clients as Organizations" (#40, #49). It is idempotent: a second run changes nothing.

It does three things:

1. Deletes Organizations that duplicate another Organization's Agency DAO (Better-Auth metadata `daoAccountId`), through the auth API. For each DAO it keeps the Organization already mapped in `organization_daos`, otherwise the oldest one. Personal Organizations are never touched.
2. Maps each remaining Agency DAO to its Organization in `api_db.organization_daos`.
3. Deletes `client_projects` links to Projects that no longer exist in `projects_db`.

### Environment

| Variable | Meaning |
| --- | --- |
| `API_DATABASE_URL` | `api_db` |
| `PROJECTS_DATABASE_URL` | `projects_db`, read only |
| `AUTH_BASE_URL` | Host that serves `/api/auth/*`, for example `https://multiagency.ai` |
| `AUTH_SESSION_COOKIE` | Cookie header of a session that owns every duplicate Organization. The auth API only lists the caller's own Organizations. |

### Run order

1. Deploy the API. Its migrator creates `organization_daos` with a unique DAO index.
2. `bun run db:cleanup:organizations --dry-run` and check the report.
3. `bun run db:cleanup:organizations`.

Until step 3 runs, Organizations keep resolving their Agency DAO from metadata, so nothing changes for users. Later migration steps from #40 (Project ownership, Engagements, dropping `clients`) run after this one.

## Project ownership

`bun run db:migrate:project-ownership` moves Project ownership from the Agency DAO account to the owning Organization (#42). It is idempotent: a second run changes nothing.

For every Agency DAO mapped in `api_db.organization_daos` it:

1. Sets `organization_id` of the DAO's Projects in `projects_db` to the Organization id. `owner_id` is not changed, so existing `@<ownerId>/<slug>` mentions keep resolving.
2. Re-keys the DAO's `settings` row in `api_db` to the Organization id, unless the Organization already has one. The API migration `0006_settings_by_organization` does the same at deploy; this step covers mappings added after it ran.
3. Records the DAO as the funding Agency DAO (`budgets.funding_dao_account_id`, #44) of every Budget entry on the DAO's Projects that has none yet, whether the Project is still keyed by the DAO or already by the Organization. The API migration `0008_prepayments` fills this for entries attributed to an Engagement or a legacy client row; this step covers the Agency's own entries, whose Projects live in `projects_db`.

Projects of DAOs without a mapping are left alone and reported by neither step.

### Environment

| Variable | Meaning |
| --- | --- |
| `API_DATABASE_URL` | `api_db`, reads `organization_daos` and updates `settings` and `budgets` |
| `PROJECTS_DATABASE_URL` | `projects_db`, updates `projects.organization_id` |

### Run order

1. Run the Organization cleanup above, so each Agency DAO is mapped to one Organization. From #42 on, the API reads an Organization's Agency DAO only from `organization_daos` (connected in Settings → Treasury), not from Organization metadata.
2. Deploy the API and the projects plugin from #42. Until step 4 runs, the API still lists Projects whose `organization_id` is the Organization's Agency DAO, but members only see private Projects of that kind that they created, and the client portal only sees public ones.
3. `bun run db:migrate:project-ownership --dry-run` and check the report.
4. `bun run db:migrate:project-ownership` right after the deploy.

### Funding Agency DAO of Budget entries (#44)

1. Deploy the API from #44. Its migrator creates `prepayments` and adds `budgets.funding_dao_account_id`, filled for entries attributed to an Engagement (through the Agency's `organization_daos` row) or to a legacy client row (`clients.agency_dao_account_id`).
2. `bun run db:migrate:project-ownership --dry-run` and check `fundedBudgets`: the Agency's own Budget entries that still have no funding DAO.
3. `bun run db:migrate:project-ownership`. Entries of Projects whose Organization has no Agency DAO keep an empty funding DAO; they cannot exist from #44 on, because the Budgets routes require an Agency DAO.

## Assign an Organization owner

`bun run db:assign-owner <organization-id> <user-email-or-id> [--dry-run]` recovers an Organization that has no owner left (#41). It works directly on the auth database, because the auth API only lets members of an Organization change its members.

It refuses personal Organizations and Organizations that still have an owner, so an owner is never overridden. If the user is already a member, it promotes them to owner; otherwise it adds them as owner. The user is found by id or by email (case-insensitive) in the `user` table and must already have an account.

It reads the `user`, `organization` and `member` tables and detects whether `member` uses camelCase (`organizationId`, `userId`, `createdAt`, Better-Auth's default) or snake_case columns.

### Environment

| Variable | Meaning |
| --- | --- |
| `AUTH_DATABASE_URL` | The auth plugin's database |

### Run

1. `bun run db:assign-owner <organization-id> <email> --dry-run` and check the report (`action` is `promoted` or `added`).
2. Run it again without `--dry-run`.

## Engagements

`bun run db:migrate:engagements` turns the legacy `clients` rows into Engagements (#43). It is idempotent: a second run changes nothing, and `--dry-run` reports what it would do.

In `api_db` it:

1. Creates an active Engagement for each `clients` row between the Agency's Organization (found through `organization_daos` by the row's Agency DAO) and the Client's existing Organization (`clients.org_id`). The Engagement remembers the row in `legacy_client_id`, so a rerun finds it again. Rows whose Agency DAO has no Organization are reported as `UNMAPPED_AGENCY_DAO` and left alone.
2. Copies the row's `client_projects` into `engagement_projects`.
3. Points each Budget entry attributed to the row (`budgets.client_id`) at the Engagement (`budgets.engagement_id`). `client_id` stays until the `clients` table is dropped (#48).
4. Fills `project_contributors.organization_id` from `projects_db`, so Contributors see their assigned Projects under "My work".

In `auth_db` it hands each Client Organization over to the Client:

5. Finds the user of the row's NEAR wallet (`clients.near_account_id`) through the NEAR account table and makes them owner of the Client's Organization (added, or promoted if already a member).
6. Removes every member of the Client's Organization who is also a member of the Agency's Organization, except that wallet user. For NEAR Foundation this makes `work.efiz.near` owner and removes `agenticweb.near`.

A row without a wallet (`no-wallet`) or whose wallet has never signed in (`no-wallet-user`) keeps its members; fix it later with `db:assign-owner`, then run this script again to remove Agency staff.

### Environment

| Variable | Meaning |
| --- | --- |
| `API_DATABASE_URL` | `api_db` |
| `PROJECTS_DATABASE_URL` | `projects_db`, read only |
| `AUTH_DATABASE_URL` | The auth plugin's database |

### Run order

1. Run the Organization cleanup and the Project ownership migration above, in that order.
2. Deploy the API from #43 with `AUTH_DATABASE_URL` set for it (see below). Its migrator creates `engagements`, `engagement_projects` and `notifications`, and adds `budgets.engagement_id` and `project_contributors.organization_id`. From this deploy on, the client portal reads through Engagements only, so run step 4 right after it.
3. `bun run db:migrate:engagements --dry-run` and check the report: NEAR Foundation should be `created` with its shared Projects, and its handover should show `work.efiz.near`'s user as owner with `agenticweb.near`'s user removed.
4. `bun run db:migrate:engagements`.
5. Ask NEAR Foundation's owner (`work.efiz.near`) to add an email on their Profile, so Engagement notifications reach them by email and not only in the app.

The `clients` and `client_projects` tables stay, unused, until #48 drops them.

## The API and the auth database

From #43 the API reads the auth database directly (`AUTH_DATABASE_URL`, the same database the auth plugin uses). The auth plugin's API only acts as the signed-in caller, so it cannot:

- create a Client Organization without making the Agency admin its owner,
- let the Agency manage the Client's first-admin invitation after it created the Organization without joining it,
- find an Organization the caller is not a member of by its slug,
- name the owners and admins of another Organization to notify them,
- list the caller's Organizations with their role for the switcher.

The API writes only two things there: a new Organization with no members, and the first-admin invitation (created, re-dated, canceled). Accepting the invitation still goes through the auth plugin. The invitation email is sent by the API through Resend (`RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`), with the same `/accept-invitation/<id>` link the auth plugin uses.

Without `AUTH_DATABASE_URL` the API still starts, but creating Clients, finding Organizations by slug, notifications and the switcher's list are unavailable.
