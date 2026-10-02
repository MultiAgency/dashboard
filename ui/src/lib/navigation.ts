export type WorkspaceRole = "owner" | "admin" | "member";

export type NavItem = { to: string; label: string; match?: string };

export type NavGroup = { title: string; items: NavItem[] };

export type WorkspaceView = "agency" | "client";

export type WorkspaceAccess = {
  role: WorkspaceRole | null;
  hasAgencyDao: boolean;
  hasAgencySections: boolean;
  hasClientSections: boolean;
};

export function availableViews(
  access: Pick<WorkspaceAccess, "hasAgencySections" | "hasClientSections">,
): WorkspaceView[] {
  const views: WorkspaceView[] = [];
  if (access.hasAgencySections) views.push("agency");
  if (access.hasClientSections) views.push("client");
  return views;
}

export function resolveView(
  access: Pick<WorkspaceAccess, "hasAgencySections" | "hasClientSections">,
  preferred: WorkspaceView | null,
): WorkspaceView {
  const views = availableViews(access);
  if (preferred && views.includes(preferred)) return preferred;
  return views[0] ?? "agency";
}

export function viewHome(view: WorkspaceView): string {
  return view === "client" ? "/client/projects" : "/admin/projects";
}

export const CLIENT_ADMIN_PATHS = ["/admin/members"];

export function viewForPath(pathname: string): WorkspaceView | null {
  const path = pathname.replace(/\/+$/, "");
  if (path === "/client" || path.startsWith("/client/")) return "client";
  if (CLIENT_ADMIN_PATHS.includes(path)) return null;
  if (path === "/admin" || path.startsWith("/admin/")) return "agency";
  return null;
}

export function isWorkspaceRole(role: string | null | undefined): role is WorkspaceRole {
  return role === "owner" || role === "admin" || role === "member";
}

export function isManager(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function workspaceNavigation(
  access: WorkspaceAccess,
  view: WorkspaceView = resolveView(access, null),
): NavGroup[] {
  if (!access.role) return [];
  const manager = isManager(access.role);
  if (view === "client") return clientNavigation(manager);
  const groups: NavGroup[] = [
    {
      title: "Work",
      items: [
        { to: "/admin/projects", label: "Projects" },
        { to: "/admin/reports", label: "Reports" },
      ],
    },
    {
      title: "People",
      items: [
        ...(manager ? [{ to: "/admin/engagements", label: "Engagements" }] : []),
        { to: "/admin/contributors", label: "Builders", match: "/admin/contributors" },
        ...(manager ? [{ to: "/admin/members", label: "Team" }] : []),
      ],
    },
  ];
  if (access.hasAgencyDao) {
    groups.push({
      title: "Money",
      items: [
        { to: "/admin/billings", label: "Billings" },
        { to: "/admin/budgets", label: "Budgets" },
      ],
    });
  }
  if (manager) {
    groups.push({ title: "Setup", items: [{ to: "/admin/settings", label: "Settings" }] });
  }
  return groups;
}

function clientNavigation(manager: boolean): NavGroup[] {
  return [
    {
      title: "Work",
      items: [
        { to: "/client/projects", label: "Projects" },
        { to: "/client/reports", label: "Reports" },
      ],
    },
    {
      title: "People",
      items: [
        { to: "/client", label: "Agencies" },
        ...(manager ? [{ to: "/admin/members", label: "Team" }] : []),
      ],
    },
  ];
}

export type EngagementStatus = "proposed" | "active" | "declined" | "ended";

export type EngagementKind = "client" | "subcontract";

export function acceptsIdeas(kind: EngagementKind): boolean {
  return kind === "client";
}

export function clientEngagementSections(engagementId: string, kind: EngagementKind): NavItem[] {
  const base = `/client/${engagementId}`;
  return [
    { to: base, label: "Overview" },
    { to: `${base}/projects`, label: "Shared projects" },
    { to: `${base}/prepayments`, label: "Prepayments" },
    { to: `${base}/plan`, label: "Plan & Change orders" },
    { to: `${base}/billings`, label: "Billings" },
    { to: `${base}/reports`, label: "Reports" },
    ...(acceptsIdeas(kind) ? [{ to: `${base}/ideas`, label: "Ideas" }] : []),
  ];
}

export function canReadEngagement(status: EngagementStatus): boolean {
  return status === "active" || status === "ended";
}
