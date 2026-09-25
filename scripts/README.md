# Scripts

## Organization cleanup

`bun run db:cleanup:organizations` prepares production data for "Clients as Organizations" (#40, #49). It is idempotent: a second run changes nothing.

It does two things:

1. Deletes Organizations that duplicate another Organization's Agency DAO (Better-Auth metadata `daoAccountId`), through the auth API. For each DAO it keeps the Organization already mapped in `organization_daos`, otherwise the oldest one. Personal Organizations are never touched.
2. Maps each remaining Agency DAO to its Organization in `api_db.organization_daos`.

Up to #47 it also deleted legacy `client_projects` links to Projects that no longer exist. That table is dropped in #48; run the cleanup from a #47 build if that step has not run yet (see [Deploy order](#deploy-order-49--48)).

### Environment

| Variable | Meaning |
| --- | --- |
| `API_DATABASE_URL` | `api_db` |
| `AUTH_BASE_URL` | Host that serves `/api/auth/*`, for example `https://multiagency.ai` |
| `AUTH_SESSION_COOKIE` | Cookie header of a session that owns every duplicate Organization. The auth API only lists the caller's own Organizations. |

### Run order

1. Deploy the API. Its migrator creates `organization_daos` with a unique DAO index.
2. `bun run db:cleanup:organizations --dry-run` and check the report.
3. `bun run db:cleanup:organizations`.

Until step 3 runs, Organizations keep resolving their Agency DAO from metadata, so nothing changes for users. Later migration steps from #40 (Project ownership, Engagements, dropping `clients`) run after this one.

Organization metadata is read only for `daoAccountId` and `isPersonal`. The old `type` flag is never read or written (#48).

## Project ownership

`bun run db:migrate:project-ownership` moves Project ownership from the Agency DAO account to the owning Organization (#42). It is idempotent: a second run changes nothing.

For every Agency DAO mapped in `api_db.organization_daos` it:

1. Sets `organization_id` of the DAO's Projects in `projects_db` to the Organization id. `owner_id` is not changed, so existing `@<ownerId>/<slug>` mentions keep resolving.
2. Re-keys the DAO's `settings` row in `api_db` to the Organization id, unless the Organization already has one. The API migration `0006_settings_by_organization` does the same at deploy; this step covers mappings added after it ran.
3. Records the DAO as the funding Agency DAO (`budgets.funding_dao_account_id`, #44) of every Budget entry on the DAO's Projects that has none yet, whether the Project is still keyed by the DAO or already by the Organization. The API migration `0008_prepayments` fills this for entries attributed to an Engagement or a legacy client row; this step covers the Agency's own entries, whose Projects live in `projects_db`.
4. Records the DAO as the paying Agency DAO (`billings.paying_dao_account_id`, #46) of every Billing on the DAO's Projects that has none yet. Before #46 only the owning Agency billed its Projects.

Projects of DAOs without a mapping are left alone and reported by neither step.

### Environment

| Variable | Meaning |
| --- | --- |
| `API_DATABASE_URL` | `api_db`, reads `organization_daos` and updates `settings`, `budgets` and `billings` |
| `PROJECTS_DATABASE_URL` | `projects_db`, updates `projects.organization_id` |

### Run order

1. Run the Organization cleanup above, so each Agency DAO is mapped to one Organization. From #42 on, the API reads an Organization's Agency DAO only from `organization_daos` (connected in Settings → Treasury), not from Organization metadata.
2. Deploy the API and the projects plugin from #42. Until step 4 runs, the API from #42 to #47 still lists Projects whose `organization_id` is the Organization's Agency DAO (and reads settings still keyed by it), but members only see private Projects of that kind that they created, and the client portal only sees public ones.
3. `bun run db:migrate:project-ownership --dry-run` and check the report.
4. `bun run db:migrate:project-ownership` right after the deploy.

From #48 the API reads Projects and settings by Organization id only. A Project or settings row still keyed by the Agency DAO is invisible, so **#48 must be deployed only after this script has run**. The script stays: a rerun is harmless and reports nothing.

### Funding Agency DAO of Budget entries (#44)

1. Deploy the API from #44. Its migrator creates `prepayments` and adds `budgets.funding_dao_account_id`, filled for entries attributed to an Engagement (through the Agency's `organization_daos` row) or to a legacy client row (`clients.agency_dao_account_id`).
2. `bun run db:migrate:project-ownership --dry-run` and check `fundedBudgets`: the Agency's own Budget entries that still have no funding DAO.
3. `bun run db:migrate:project-ownership`. Entries of Projects whose Organization has no Agency DAO keep an empty funding DAO; they cannot exist from #44 on, because the Budgets routes require an Agency DAO.

### Paying Agency DAO of Billings (#46)

1. Deploy the API from #46. Its migrator adds `billings.paying_dao_account_id`, filled for Billings attributed to a legacy client row (`clients.agency_dao_account_id`) or on a Project whose Budget entries are all funded by one Agency DAO. It replaces the unique proposal index with one on (paying DAO, proposal id), because every DAO numbers its proposals on its own. It also adds `project_contributors.assigned_by_organization_id`, filled from `organization_id`, since every existing assignment was made by the owning Agency.
2. `bun run db:migrate:project-ownership --dry-run` and check `paidBillings`: Billings on the DAO's Projects that still have no paying DAO. Before #46 only the owning Agency could bill, so they were all paid by its DAO.
3. `bun run db:migrate:project-ownership`. Until it runs, the API reads a Billing without a paying DAO as paid by the owning Agency's DAO, and refuses to record a Billing whose proposal id matches one of them.

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

`bun run db:migrate:engagements` turned the legacy `clients` rows into Engagements (#43). It is idempotent: a second run changes nothing, and `--dry-run` reports what it would do.

**Retired in #48.** Its source tables (`clients`, `client_projects`, `budgets.client_id`) are dropped by the #48 migration, so the script and its service are removed. Run it from the #47 build, before deploying #48.

In `api_db` it:

1. Creates an active Engagement for each `clients` row between the Agency's Organization (found through `organization_daos` by the row's Agency DAO) and the Client's existing Organization (`clients.org_id`). The Engagement remembers the row in `legacy_client_id`, so a rerun finds it again. It skips, and leaves alone, rows whose Agency DAO has no Organization (`UNMAPPED_AGENCY_DAO`), rows whose Agency and Client are the same Organization (`SELF_ENGAGEMENT`), and rows whose pair already has an active Engagement (`ACTIVE_ENGAGEMENT_EXISTS`).
2. Copies the row's `client_projects` into `engagement_projects`.
3. Points each Budget entry attributed to the row (`budgets.client_id`) at the Engagement (`budgets.engagement_id`).
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

From the #47 build, right after deploying it (the client portal reads through Engagements only from then on):

1. `bun run db:migrate:engagements --dry-run` and check the report: NEAR Foundation should be `created` with its shared Projects, and its handover should show `work.efiz.near`'s user as owner with `agenticweb.near`'s user removed.
2. `bun run db:migrate:engagements`.
3. Ask NEAR Foundation's owner (`work.efiz.near`) to add an email on their Profile, so Engagement notifications reach them by email and not only in the app.

## Dropping the legacy Client model (#48)

The API migration `0013_drop_clients` drops `clients`, `client_projects` and `budgets.client_id`. It runs inside the API's migrator at deploy and first checks that the Engagements migration is complete. A `clients` row is covered by its migrated Engagement (`legacy_client_id`), or by an active or ended Engagement of the same pair (the Agency's Organization through `organization_daos`, and `clients.org_id`). The migration refuses, and leaves every table in place, when any of these is true:

- a `clients` row has no covering Engagement, unless its Agency and Client are the same Organization,
- a `client_projects` row is not in a covering Engagement's `engagement_projects`,
- a Budget entry with a `client_id` is not on a covering Engagement.

The error reads "Legacy clients are not migrated to Engagements yet". The migration runs in a transaction, so a refusal changes nothing. Fix it, then deploy #48 again:

- `UNMAPPED_AGENCY_DAO`: map the Agency DAO to its Organization (Organization cleanup, or Settings → Treasury) or delete the row, then run `db:migrate:engagements` again from the #47 build.
- `SELF_ENGAGEMENT`: the row is dropped as it is if it has no `client_projects` and no Budget entries. Otherwise delete its `client_projects` rows and clear `client_id` on its Budget entries (`UPDATE budgets SET client_id = NULL WHERE client_id = '<client-id>'`), since an Agency's own Projects need no Engagement.
- `ACTIVE_ENGAGEMENT_EXISTS`: attach the row's links and Budget entries to the pair's Engagement. Find it with:

  ```sql
  SELECT c.id AS client_id, e.id AS engagement_id, e.status
  FROM clients c
  JOIN organization_daos d ON d.dao_account_id = c.agency_dao_account_id
  JOIN engagements e ON e.agency_organization_id = d.organization_id
    AND e.client_organization_id = c.org_id
    AND e.status IN ('active', 'ended')
  WHERE NOT EXISTS (SELECT 1 FROM engagements l WHERE l.legacy_client_id = c.id);
  ```

  Then, for each row (pick the active Engagement if the pair has several):

  ```sql
  BEGIN;
  INSERT INTO engagement_projects (engagement_id, project_id)
  SELECT '<engagement-id>', project_id FROM client_projects WHERE client_id = '<client-id>'
  ON CONFLICT DO NOTHING;
  UPDATE budgets SET engagement_id = '<engagement-id>'
  WHERE client_id = '<client-id>' AND engagement_id IS NULL;
  COMMIT;
  ```

## Deploy order (#49 → #48)

Each script supports `--dry-run`; run it and check the report before the real run.

1. Deploy the API from #49. The migrator creates `organization_daos` (`0005`).
2. `bun run db:cleanup:organizations` (Organization cleanup above).
3. Deploy the UI, the API and the projects plugin from #47 (which includes #41 to #46), with `AUTH_DATABASE_URL`, `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL` and `APP_ORIGIN` (the public app origin used in email links; the `appOrigin` variable is the fallback) set for the API. The migrator adds `0006` to `0012` (settings by Organization, Engagements, Prepayments, Change orders, subcontracting with dropping the billings client column, ideas, agent links and saved reports).
4. `bun run db:migrate:project-ownership` (Project ownership above). It moves Projects and settings to the Organization and fills the funding and paying Agency DAOs of Budget entries and Billings.
5. `bun run db:migrate:engagements` from the #47 build (Engagements above). It turns `clients` rows into Engagements and hands Client Organizations over. Resolve every skipped row as described in [Dropping the legacy Client model](#dropping-the-legacy-client-model-48).
6. Ask NEAR Foundation's owner to add an email on their Profile.
7. Deploy the UI and the API from #48. The migrator runs `0013_drop_clients`, which refuses if step 5 is incomplete. The #48 API reads Projects and settings by Organization id only, so step 4 must have run.

`bun run db:assign-owner` can run at any point from #41 on, whenever an Organization has no owner left.

## The API and the auth database

From #43 the API reads the auth database directly (`AUTH_DATABASE_URL`, the same database the auth plugin uses). The auth plugin's API only acts as the signed-in caller, so it cannot:

- create a Client Organization without making the Agency admin its owner,
- let the Agency manage the Client's first-admin invitation after it created the Organization without joining it,
- find an Organization the caller is not a member of by its slug,
- name the owners and admins of another Organization to notify them,
- list the caller's Organizations with their role for the switcher.

The API writes only two things there: a new Organization with no members, and the first-admin invitation (created, re-dated, canceled). Accepting the invitation still goes through the auth plugin. The invitation email is sent by the API through Resend (`RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`), with the same `/accept-invitation/<id>` link the auth plugin uses.

Without `AUTH_DATABASE_URL` the API still starts, but creating Clients, finding Organizations by slug, notifications and the switcher's list are unavailable.
