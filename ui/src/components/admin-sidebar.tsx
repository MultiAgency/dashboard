import { Link, useMatchRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useWorkspaceView } from "@/hooks/use-workspace-view";
import {
  type NavItem,
  viewForPath,
  viewHome,
  type WorkspaceView,
  workspaceNavigation,
} from "@/lib/navigation";

const VIEW_LABELS: Record<WorkspaceView, string> = { agency: "Agency", client: "Client" };

export function AdminSidebar() {
  const matchRoute = useMatchRoute();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const workspace = useWorkspaceView();
  const { orgRole, agencyDao, hasAgencySections, hasClientSections, views, setView } = workspace;
  const pathView = viewForPath(pathname);
  const view = pathView && views.includes(pathView) ? pathView : workspace.view;
  const groups = workspaceNavigation(
    {
      role: orgRole,
      hasAgencyDao: agencyDao !== null,
      hasAgencySections,
      hasClientSections,
    },
    view,
  );

  const matching = groups
    .flatMap((group) => group.items)
    .filter((item) => !!matchRoute({ to: item.match ?? item.to, fuzzy: true }));
  const activeTo = matching.reduce<string | null>(
    (best, item) => (best === null || item.to.length > best.length ? item.to : best),
    null,
  );
  const isActive = (item: NavItem) => item.to === activeTo;

  const switchView = (next: string) => {
    if (next !== "agency" && next !== "client") return;
    setView(next);
    void navigate({ to: viewHome(next) });
  };

  return (
    <nav
      aria-label="Organization"
      className="-mx-4 flex flex-col gap-3 border-b px-4 pb-3 lg:mx-0 lg:w-48 lg:shrink-0 lg:gap-5 lg:border-b-0 lg:px-0 lg:pb-0"
    >
      {views.length > 1 && (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={view}
          onValueChange={switchView}
          aria-label="Viewing as"
          className="w-full"
        >
          {views.map((v) => (
            <ToggleGroupItem key={v} value={v} className="flex-1">
              {VIEW_LABELS[v]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      <div className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-5 lg:overflow-visible">
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
      </div>
    </nav>
  );
}
