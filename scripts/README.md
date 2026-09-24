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
