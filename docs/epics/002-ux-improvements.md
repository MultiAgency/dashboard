# Epic 002: UX/UI Improvements — Demo-Ready Admin Flow

### Context

Admin functions are currently scattered across operator tabs on public pages (`/team`, `/work`, `/treasury`). The project form is two separate forms with a hand-typed slug and no NEARN helper text. Budget actions exist only in the Treasury tab, not on the project detail page. Contributor assignment shows no cross-project context. Internal listing status flags are independent checkboxes instead of a lifecycle control. Documentation styling is minimal and hard to read. Admin list UIs use basic HTML tables with no sorting, filtering, or column management. This epic creates a coherent admin navigation shell, consolidates admin routes, fixes UX paper cuts, and introduces TanStack Table for all admin data grids so the product is demo-ready and provides the table foundation for Epic 3 reporting. Public pages (`/work`, `/treasury`, `/team`) remain accessible — admin sections are extracted from operator tabs, not deleted.

### Overview

Consolidate admin routes behind a dedicated shell at `ui/src/routes/_layout/_authenticated/admin/` with sidebar navigation. Fix UX paper cuts (002-01 through 002-04). Improve documentation legibility and design (002-05). Introduce `@tanstack/react-table` for all admin data grids (002-06), providing the DataTable foundation for Epic 003 reporting.

**002-02** includes the contributor assignment cross-project visibility — the `AssignmentsSection` component (`ui/src/components/projects-admin-section.tsx`, lines 475-598) already lists available contributors; adding cross-project assignment badges from the `assignments.list` API is a natural enhancement to the admin shell (merged from #11).

**002-04** references the existing `BudgetsManager` component (`ui/src/components/budgets-manager.tsx`, 646 lines) — the allocate/deallocate forms live there; this ticket moves them onto the project detail page at `/admin/projects/{slug}`.

### Tickets

| # | Ticket | Dependency | Issue |
|---|--------|------------|-------|
| 002-01 | Fix listing status flags to lifecycle single-select | — | #7 |
| 002-02 | Dedicated admin shell and standalone routes | — | #8 |
| 002-03 | Simplify project create/edit form | — | #9 |
| 002-04 | Budget actions on project detail page | — | #10 |
| 002-05 | Documentation design improvements | — | #12 |
| 002-06 | TanStack Table data grids | 002-02 | #13 |

> **002-05 (Contributor cross-project visibility on assignment, #11) has been merged into 002-02.** The assignment badges ship as part of the admin shell.

### Acceptance Criteria

- [ ] Internal listing status is a single-select control (radio or dropdown), not three checkboxes
- [ ] Admin sidebar navigation exists with routes: Projects, Contributors, Budgets, Billings, Applications, Settings
- [ ] Admin sections are removed from operator tabs on public pages (`/work`, `/treasury`, `/team` remain functional and good-looking)
- [ ] Project form is a single form (not two) with auto-generated slug and NEARN helper text
- [ ] Budget allocate/deallocate actions are available on `/admin/projects/{slug}`
- [ ] Contributor assignment dropdown shows cross-project assignments
- [ ] Documentation is legible and well-designed — font sizing, diagram rendering, responsive layout
- [ ] All admin list UIs use `@tanstack/react-table` with sorting, filtering, pagination, and column visibility
- [ ] All existing functionality preserved
- [ ] `bun typecheck` and `bun lint` pass
