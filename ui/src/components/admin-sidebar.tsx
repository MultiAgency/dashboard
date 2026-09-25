import { Link, useMatchRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useMeRoles } from "@/hooks/use-me-roles";
import { type NavItem, workspaceNavigation } from "@/lib/navigation";

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
    <nav
      aria-label="Organization"
      className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 pb-3 lg:mx-0 lg:w-48 lg:shrink-0 lg:flex-col lg:gap-5 lg:overflow-visible lg:border-b-0 lg:px-0 lg:pb-0"
    >
      {groups.map((group) => (
        <div key={group.title} className="flex shrink-0 gap-1 lg:flex-col">
          <p className="hidden px-2 pb-1 text-xs font-medium text-muted-foreground lg:block">
            {group.title}
          </p>
          {group.items.map((item) => {
            const active = isActive(item);
            return (
              <Button
                key={item.to}
                asChild
                variant={active ? "secondary" : "ghost"}
                size="sm"
                className="justify-start lg:w-full"
              >
                <Link to={item.to} aria-current={active ? "page" : undefined}>
                  {item.label}
                </Link>
              </Button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
