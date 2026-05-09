import { Link, useLocation } from "@tanstack/react-router";

const items = [
  { to: "/admin/projects", label: "projects" },
  { to: "/admin/contributors", label: "contributors" },
  { to: "/admin/allocations", label: "allocations" },
  { to: "/admin/billings", label: "billings" },
  { to: "/admin/proposals", label: "proposals" },
  { to: "/admin/applications", label: "applications" },
] as const;

export function AdminNav() {
  const location = useLocation();
  return (
    <nav className="flex flex-wrap gap-2 text-xs font-mono">
      {items.map((it) => {
        const active = location.pathname === it.to;
        return (
          <Link
            key={it.to}
            to={it.to}
            className={`px-3 py-1.5 rounded-sm border transition-colors ${
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
