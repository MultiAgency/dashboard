import { createFileRoute } from "@tanstack/react-router";
import { ProjectsAdminSection } from "@/components/projects-admin-section";

export const Route = createFileRoute("/_layout/_authenticated/_configured/_admin/admin/projects/")({
  head: () => ({
    meta: [{ title: "Projects | Admin" }],
  }),
  component: AdminProjectsIndex,
});

function AdminProjectsIndex() {
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          admin · projects
        </div>
        <h2 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Projects
        </h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Create, edit, and manage project records from the admin surface.
        </p>
      </div>

      <ProjectsAdminSection />
    </section>
  );
}
