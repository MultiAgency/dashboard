import { Link, useMatchRoute } from "@tanstack/react-router";
import { useMeRoles } from "@/hooks/use-me-roles";
import { type NavItem, workspaceNavigation } from "@/lib/navigation";

const LINK_BASE =
  "font-mono text-xs uppercase tracking-widest px-3 py-2 rounded-sm transition-colors block";
const LINK_ACTIVE = "bg-foreground text-background";
const LINK_INACTIVE = "text-muted-foreground hover:text-foreground hover:bg-muted/40";
const GROUP_LABEL =
  "font-mono text-xs uppercase tracking-widest text-muted-foreground/70 px-3 pt-3 pb-1 first:pt-0";

export function AdminSidebar() {
  const matchRoute = useMatchRoute();
  const { orgRole, agencyDao, hasClientSections } = useMeRoles();
  const groups = workspaceNavigation({
    role: orgRole,
    hasAgencyDao: agencyDao !== null,
    hasClientSections,
  });

  const isActive = (item: NavItem) => !!matchRoute({ to: item.match ?? item.to, fuzzy: true });

  return (
    <nav className="flex flex-row gap-4 overflow-x-auto border-b border-border pb-px lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:pr-4 lg:pb-0 lg:w-44 lg:shrink-0">
      {groups.map((group) => (
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
