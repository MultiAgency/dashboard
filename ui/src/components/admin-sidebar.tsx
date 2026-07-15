import { Link, useMatchRoute } from "@tanstack/react-router";

const NAV_ITEMS = [
  { to: "/admin/projects", label: "projects" },
  { to: "/admin/contributors", label: "contributors" },
  { to: "/admin/budgets", label: "budgets" },
  { to: "/admin/billings", label: "billings" },
  { to: "/admin/applications", label: "applications" },
  { to: "/admin/settings", label: "settings" },
] as const;

const LINK_BASE =
  "font-mono text-[11px] uppercase tracking-[0.18em] px-3 py-2 rounded-sm transition-colors block";
const LINK_ACTIVE = "bg-foreground text-background";
const LINK_INACTIVE = "text-muted-foreground hover:text-foreground hover:bg-muted/40";

export function AdminSidebar() {
  const matchRoute = useMatchRoute();

  return (
    <nav className="flex flex-row gap-1 overflow-x-auto border-b border-border pb-px lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:pr-4 lg:pb-0 lg:w-44 lg:shrink-0">
      {NAV_ITEMS.map((item) => {
        const isActive = !!matchRoute({ to: item.to, fuzzy: true });
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`${LINK_BASE} ${isActive ? LINK_ACTIVE : LINK_INACTIVE}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
