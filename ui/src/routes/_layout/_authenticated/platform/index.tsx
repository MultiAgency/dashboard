import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_authenticated/platform/")({
  component: PlatformHome,
});

function PlatformHome() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Platform Admin</h1>
      <p className="text-muted-foreground">Manage organizations and platform-level settings.</p>
    </div>
  );
}
