# Epic 001: Tech Debt & Auth Modernization

### Context

The current auth system couples `api/src/index.ts` to env-based DAO resolution, on-chain Sputnik role checks (lines 269-306), and cookie-based NEAR account resolution via cross-service HTTP fetch to `/api/auth/near/list-accounts` (lines 217-235). The projects plugin at `plugins/projects/` introduces new `kind` values (`scope`, `result`), a global slug constraint, mention linking, and a refined context shape (`walletAddress`, `user.role`). This epic removes the env/DAO coupling, adopts standard better-auth organizations for identity and role gating, aligns the API with the new projects plugin contract, and sets up continuous deployment via GitHub Actions and Railway.

API routes currently wrapped by env-derived `orgAccountId` and DAO-based `gates` will gate on `requireOrganization` + `requireRole` from `api/src/lib/auth.ts` instead. Organizations are typed — the agency org (type: `agency`) has `admin` and `contributor` roles; each client is its own organization (type: `client`) with `admin` and `team_member` roles. Agency admins in the agency org have app-wide visibility: cross-org queries are handled by a simple branch in API handlers — if agency admin, query all orgs; otherwise scope to `context.organizationId`.

The current route naming uses an `admin` prefix (`adminList`, `adminGet`, `adminCreate`) to distinguish privileged endpoints from public ones. With the new auth model, the endpoint name describes the operation (`list`, `get`, `create`, `update`, `delete`) and the middleware stack handles auth. A single endpoint serves both public and privileged consumers — the response shape adapts based on role. No separate public/admin endpoints for the same resource. The Sputnik DAO integration remains for treasury/team display queries but is no longer the auth layer — `userInRole()` stays as a utility in `sputnik.ts` but is never called during request gating.

### Overview

Two tickets:

**001-01** — Replace the Sputnik `requireRoles`/`gates` system in `api/src/index.ts` with `requireOrganization` + `requireRole` from `api/src/lib/auth.ts`. Remove `getOrgAccountId()` and the HTTP loopback to `/api/auth/near/list-accounts`. Restructure `proxyCtx(orgAccountId)` (line 373) to pass real session data (`organizationId`, `user.role`) instead of impersonating the DAO. Strip the `admin` prefix from all route names (`contributors.adminList` → `contributors.list`, `budgets.adminCreate` → `budgets.create`, etc.) — the endpoint name describes the operation, the middleware handles auth, and the response shape adapts to role. Cross-org queries: agency admin sees all orgs; others scoped to `context.organizationId`. No org switching, no per-client-org admin assignments needed. The projects plugin already supports `scope`/`result` kinds — these pass through the API without new work.

**001-02** — Create `.github/workflows/ci.yml` (bun install, typecheck, lint, test) and configure Railway deployment on pushes to main.

### Tickets

| # | Ticket | Dependency | Issue |
|---|--------|------------|-------|
| 001-01 | Replace env-based auth with better-auth orgs, roles, and session identity | — | #4 |
| 001-02 | Continuous deployment pipeline via GitHub Actions and Railway | 001-01 | #6 |

> **001-02 (Pass session context to projects plugin, #5) has been merged into 001-01.** The proxyCtx restructuring and scope/result pass-through ship as part of the auth modernization.

### Acceptance Criteria

- [ ] `AGENCY_ORG_ACCOUNT_*` env vars are no longer required for auth
- [ ] Organization identity comes from the active better-auth organization on the session (`context.organizationId`)
- [ ] Role gating uses `requireOrganization` + `requireRole` from `api/src/lib/auth.ts` — no more `gates.admin` / `gates.operator`
- [ ] Route names describe the operation (`list`, `create`, `update`, `delete`), not the access level — no `admin` prefix
- [ ] Single endpoint per resource; response shape adapts to role (no separate public/admin versions)
- [ ] No HTTP fetch to `/api/auth/near/list-accounts` in request path
- [ ] No Sputnik DAO RPC call during auth gating
- [ ] Cross-org queries handled simply: agency admin sees all orgs; others scoped to `context.organizationId`
- [ ] `proxyCtx` passes proper `organizationId` and `user.role` to the projects plugin
- [ ] New project kinds (`scope`, `result`) are supported in agency API
- [ ] CI/CD pipeline: GitHub Actions CI passes, Railway deploys successfully
- [ ] All existing admin functionality works under new auth model
- [ ] `bun typecheck` and `bun lint` pass
