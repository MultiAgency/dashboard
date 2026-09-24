export type WorkspaceRole = "owner" | "admin" | "member";

export type NavItem = { to: string; label: string; match?: string };

export type NavGroup = { title: string; items: NavItem[] };

export type WorkspaceAccess = {
  role: WorkspaceRole | null;
  hasAgencyDao: boolean;
  hasClientSections: boolean;
};

export function isWorkspaceRole(role: string | null | undefined): role is WorkspaceRole {
  return role === "owner" || role === "admin" || role === "member";
}

export function isManager(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function workspaceNavigation(access: WorkspaceAccess): NavGroup[] {
  if (!access.role) return [];
  const manager = isManager(access.role);
  const groups: NavGroup[] = [
    {
      title: "work",
      items: [
        { to: "/admin/projects", label: "projects" },
        { to: "/admin/reports", label: "reports" },
      ],
    },
    {
      title: "people",
      items: [
        ...(manager ? [{ to: "/admin/engagements", label: "engagements" }] : []),
        { to: "/admin/contributors", label: "builders", match: "/admin/contributors" },
        ...(manager ? [{ to: "/admin/members", label: "team" }] : []),
      ],
    },
  ];
  if (access.hasAgencyDao) {
    groups.push({
      title: "money",
      items: [
        { to: "/admin/billings", label: "billings" },
        { to: "/admin/budgets", label: "budgets" },
      ],
    });
  }
  if (access.hasClientSections) {
    groups.push({ title: "as client", items: [{ to: "/client", label: "agencies" }] });
  }
  if (manager) {
    groups.push({ title: "setup", items: [{ to: "/admin/settings", label: "settings" }] });
  }
  return groups;
}

export type EngagementStatus = "proposed" | "active" | "declined" | "ended";

export function clientEngagementSections(engagementId: string): NavItem[] {
  const base = `/client/${engagementId}`;
  return [
    { to: base, label: "overview" },
    { to: `${base}/projects`, label: "shared projects" },
    { to: `${base}/prepayments`, label: "prepayments" },
    { to: `${base}/billings`, label: "billings" },
    { to: `${base}/reports`, label: "reports" },
  ];
}

export function canReadEngagement(status: EngagementStatus): boolean {
  return status === "active" || status === "ended";
}
