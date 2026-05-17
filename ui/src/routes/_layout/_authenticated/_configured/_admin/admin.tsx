import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_authenticated/_configured/_admin/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <div className="space-y-8 animate-fade-in">
      <header className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          agency · admin
        </div>
        <h1 className="font-display text-4xl sm:text-6xl font-black uppercase leading-none tracking-tight">
          Admin
        </h1>
        <nav className="flex flex-wrap gap-3 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          <Link to="/admin" className="hover:text-foreground">
            dashboard
          </Link>
          <Link to="/admin/projects" className="hover:text-foreground">
            projects
          </Link>
        </nav>
      </header>

      <Outlet />
    </div>
  );
}
