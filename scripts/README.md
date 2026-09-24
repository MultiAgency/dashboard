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
