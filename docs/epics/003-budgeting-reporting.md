# Epic 003: Budgeting & Reporting

### Context

The primary objective is enabling an agency admin to configure projects, contributors (builders), and clients — where clients provide scope and allocations, contributors bill against them, and everyone gets audit trails and reports. See 003-02 notes for seed data instructions.

**Organization model (from Epic 001):** The agency org (type: `agency`) is the single agency org per tenant with `admin` and `contributor` roles. Each client is its own better-auth organization (type: `client`) with `admin` and `team_member` roles. The `agency.clients` table bridges better-auth `orgId` to agency metadata (name, `nearAccountId` for portal auth matching). No treasury/DAO columns on clients — if clients need linked treasuries later, that's a separate table.

**Builders plugin:** `plugins/builders/` (registered as `contributors` in `bos.config.json`) provides a richer contributor profile (skills, bio, links, location) and replaces the local `agency.contributors` table. Email lives in the better-auth user profile — the builders plugin stores profile enrichment only, keyed by `nearAccount`. The `agency.contributors.id` (UUID) vs builders `nearAccount` (NEAR account) PK mismatch must be resolved — assignments and billings currently reference `agency.contributors.id` via FK, and must be updated to reference `nearAccount` or maintain a mapping.

**Projects plugin:** `plugins/projects/` already supports `scope` and `result` project kinds with mention-based hierarchy (scope mentions parent, result mentions scope) — these do not need to be added, just surfaced in the agency API and UI.

**Clients:** External entities linked to projects via `agency.client_projects` join table. Budget and billing entries optionally reference a client (`client_id`). Accepted applications can be converted to builders in one click. A contributor detail page gives admins a full picture of each builder. The client portal lets clients sign in via their NEAR wallet (matched against `agency.clients.nearAccountId`) and see their own projects, budgets, billings, and generate reports — read-only, no admin controls. The report aggregates all of this into a CSV matching the product review template.

All tickets in this epic assume the auth modernization from Epic 001 (specifically 001-01) is complete. `requireRole(...)` gates use the better-auth org roles (`admin`, `contributor`, `team_member`) defined there.

### Tickets

| # | Ticket | Dependency | Issue |
|---|--------|------------|-------|
| 003-01 | Adopt builders plugin for contributors | 001-02 | #14 |
| 003-02 | Client model (includes `nearAccountId` for portal auth) | 001-01 | #15 |
| 003-03 | Scope and allocations per client (includes billing `client_id`) | 003-01, 003-02 | #16 |
| 003-04 | Report generation (reused by admin + client portal) | 003-01, 003-02, 003-03, 002-07, 002-02 | #17 |
| 003-05 | Contributor detail page | 003-01, 002-07, 002-02 | #19 |
| 003-06 | Client read-only portal | 003-02, 003-03, 003-04, 002-02, 002-07 | #20 |

> **003-05 (Application → builder conversion, #18) has been merged into 003-01.** The conversion button ships as part of the builders plugin adoption.

### Overview

Seven tickets spanning the client lifecycle and contributor ecosystem:

**003-01** — Replace `agency.contributors` table with builders plugin. Move `onboardingStatus` to `agency.project_contributors` as a per-assignment field. Migrate data. Update `assignments.create` and `billings.create` to use `nearAccount` instead of `agency.contributors.id`. Includes the application→builder conversion button (one-click on accepted applications to create builder profile via `plugins.contributors(ctx).createBuilder(...)`, merged from #18).

**003-02** — Create `agency.clients` (orgId, name, nearAccountId) and `agency.client_projects` (clientId, projectId) tables. Build CRUD API (`clients.list`, `clients.create`, `clients.update`, `clients.delete`) with admin role gating. Build admin UI at `/admin/clients/` with DataTable from 002-07.

**003-03** — Add nullable `client_id` FK to `agency.budgets` and `agency.billings`. Add client filter to API list endpoints and admin UI. The `scope`/`result` project kinds and mention hierarchy already exist in the plugin — validate they work correctly in the agency layer.

**003-04** — CSV report endpoint at `agency.reports.generate`. Format: overview, contributor stats, per-client project breakdown, notes. Downloadable via existing `downloadCsv()` pattern. Reused by admin (`/admin/reports`) and client portal (`/client/reports`) with appropriate data scoping (`clientId` param).

**003-05** — Route at `ui/src/routes/_layout/_authenticated/admin/contributors.$nearAccount.tsx`. Shows builder profile (from plugin), assigned projects (from assignments), billings (from billing list), and payment summary. Uses DataTable from 002-07.

**003-06** — Client portal at `ui/src/routes/_layout/_authenticated/client/`. Auth: session `nearAccountId` matched against `agency.clients.nearAccountId`. Scoped to client's own projects, budgets, billings. Reuses admin DataTable/project-detail components with `readOnly` prop.

### Acceptance Criteria

- [ ] Builders plugin replaces `agency.contributors` — all contributor operations proxy to the plugin
- [ ] Email lives in better-auth user profile, not in the builders plugin or `agency.contributors`
- [ ] `onboardingStatus` moves to `agency.project_contributors` as a per-assignment field
- [ ] Existing contributor data is migrated to the builders plugin
- [ ] `agency.clients` bridges better-auth `orgId` to agency metadata (name, nearAccountId) — no DAO fields
- [ ] `agency.client_projects` join table links clients to projects
- [ ] `agency.clients` has `nearAccountId` column for portal auth — matched against session on sign-in
- [ ] Budget and billing entries optionally reference a client (`client_id` FK on both tables)
- [ ] Budget and billing views are filterable by client in both API and admin UI
- [ ] Project `scope` and `result` kinds with mention-based hierarchy (scope mentions parent, result mentions scope) — already exist in plugin; validate they work in agency layer
- [ ] Accepted applications have a one-click "convert to builder" action
- [ ] `/admin/contributors/{nearAccount}` shows builder profile, projects, billings, payment summary
- [ ] Client portal at `/client/` shows dashboard, projects, project detail (read-only), and reports
- [ ] Client portal auth: session `nearAccountId` matched against `agency.clients.nearAccountId` → auto-grant `team_member` access
- [ ] Client portal data is scoped to the client's own projects/budgets/billings
- [ ] Client portal reuses admin components in `readOnly` mode
- [ ] CSV report matches the product review template: overview, contributor stats, per-client project breakdown, notes
- [ ] Report is reused by both admin and client portal with appropriate data scoping
- [ ] Report CSV is downloadable via the existing `downloadCsv()` pattern
- [ ] `bun typecheck` and `bun lint` pass
- [ ] Types should not be re-instated — infer them directly from the apiClient through the oRPC contract. Use `Awaited<ReturnType<typeof apiClient.<plugin>.<method>>>` or the generated types from `bos types gen` in `ui/src/lib/api-types.gen.ts`.
- [ ] Must follow TanStack Router best practices (prefetch data in `loader` rather than `beforeLoad`, use `router.invalidate()` after mutations)
- [ ] Must follow TanStack Query best practices (use `queryOptions` from `@/lib/queries`, optimistic updates where appropriate, proper cache invalidation after mutations)
- [ ] Must follow everything-dev and every-plugin best practices
