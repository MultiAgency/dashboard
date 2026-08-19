import { Link, useMatchRoute } from "@tanstack/react-router";

type NavItem = { to: string; label: string; match?: string };

type NavGroup = { title: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    title: "work",
    items: [{ to: "/admin/projects", label: "projects" }],
  },
  {
    title: "people",
    items: [
      { to: "/admin/clients", label: "clients" },
      { to: "/admin/contributors", label: "builders", match: "/admin/contributors" },
      { to: "/admin/members", label: "team" },
    ],
  },
  {
    title: "money",
    items: [
      { to: "/admin/billings", label: "billings" },
      { to: "/admin/reports", label: "reports" },
    ],
  },
  {
    title: "setup",
    items: [{ to: "/admin/settings", label: "settings" }],
  },
];

const LINK_BASE =
  "font-mono text-[11px] uppercase tracking-[0.18em] px-3 py-2 rounded-sm transition-colors block";
const LINK_ACTIVE = "bg-foreground text-background";
const LINK_INACTIVE = "text-muted-foreground hover:text-foreground hover:bg-muted/40";
const GROUP_LABEL =
  "font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 px-3 pt-3 pb-1 first:pt-0";

export function AdminSidebar() {
  const matchRoute = useMatchRoute();

  const isActive = (item: NavItem) => !!matchRoute({ to: item.match ?? item.to, fuzzy: true });

  return (
    <nav className="flex flex-row gap-4 overflow-x-auto border-b border-border pb-px lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:pr-4 lg:pb-0 lg:w-44 lg:shrink-0">
      {NAV_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-row gap-1 lg:flex-col lg:gap-0 shrink-0">
          <div className={GROUP_LABEL}>{group.title}</div>
          {group.items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`${LINK_BASE} ${isActive(item) ? LINK_ACTIVE : LINK_INACTIVE}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
