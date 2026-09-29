# api

## 2.2.0

### Minor Changes

- 01c451e: Tighten agency membership and client access.

  Personal and client workspace owners no longer inherit MultiAgency owner rights from the default DAO. Agency role only counts when the active workspace is an agency.

  Clients must belong to an agency (`agency_dao_account_id` is required). The client portal only lists billings on that client's linked projects. Deleting a project refreshes client pages as well as admin ones.

  The client portal reads agency projects with a read-only role instead of an admin one. Admin data is cached per network, so switching networks no longer shows the other network's projects, billings or budgets. Client budgets refresh after budget or listing changes.

### Patch Changes

- 4f35252: Fix `db.select is not a function` by making `DatabaseTag` resolve to the real Drizzle `Database` instead of the `DatabaseDriver` wrapper.

  The Effect layer in all three packages (`api`, `plugins/builders`, `plugins/projects`) was returning a `DatabaseDriver` wrapper (with only `.db` and `.close()`) as the `DatabaseTag` context value, but every service factory expected the actual Drizzle `Database` instance (with `.select()`, `.insert()`, `.update()`, `.delete()`). This caused a runtime `db.select is not a function` (500 INTERNAL_SERVER_ERROR) on every database query.

  - Changed `DatabaseTag` type from `DatabaseDriver` to `Database` in all three layer files
  - Restructured `DatabaseLive` to nest `acquireRelease` inside `Effect.gen` so the driver lifecycle (connection close) is still scope-managed, while returning `driver.db` as the tag value
  - Aligned builders plugin's `db/index.ts` to match the API reference: fixed PGlite bug (`drizzle(dataDir)` → `new PGlite(dataDir)` then `drizzle(pglite, { schema })`), added `DatabaseError` class, added pool config env var overrides, fixed no-op PGlite `close()`
  - Created builders `db/migrate.ts` (was missing — old layer imported from nonexistent `./migrator`, causing a typecheck error)
  - All three packages now share identical `db/index.ts`, `db/migrate.ts`, and `db/layer.ts` implementations
