import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_authenticated/_superadmin/admin/platform")({
  component: PlatformLayout,
});

function PlatformLayout() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          super admin · platform
        </div>
        <h2 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Platform
        </h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Create and manage organizations and assign members. Project creation and org admin live on
          each org subdomain — org admins manage those surfaces.
        </p>
      </div>

      <Outlet />
    </div>
  );
}
