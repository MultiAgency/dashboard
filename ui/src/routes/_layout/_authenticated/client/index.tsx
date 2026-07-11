import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_authenticated/client/")({
  component: ClientHome,
});

function ClientHome() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Client Portal</h1>
      <p className="text-muted-foreground">View your projects, budgets, and reports.</p>
    </div>
  );
}
