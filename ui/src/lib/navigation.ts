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
  if (access.hasClientSections) {
    groups.push({ title: "As client", items: [{ to: "/client", label: "Agencies" }] });
  }
  if (manager) {
    groups.push({ title: "Setup", items: [{ to: "/admin/settings", label: "Settings" }] });
  }
  return groups;
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
