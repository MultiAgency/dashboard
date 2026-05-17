import { createFileRoute, Link } from "@tanstack/react-router";
import { Button, Card, CardContent } from "@/components";

export const Route = createFileRoute("/_layout/_authenticated/_configured/_admin/admin/")({
  component: AdminDashboard,
});

function AdminDashboard() {
  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="space-y-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            welcome
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-black uppercase leading-none tracking-tight">
            Welcome to the Admin Dashboard
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Use this area for admin-only project management and deep operational detail.
          </p>
        </div>

        <div>
          <Button asChild variant="outline" className="font-display uppercase tracking-wide">
            <Link to="/admin/projects">open projects →</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
