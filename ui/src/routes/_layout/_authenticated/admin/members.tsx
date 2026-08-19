import { createFileRoute } from "@tanstack/react-router";
import { MembersAdminSection } from "@/components/admin/members-section";

export const Route = createFileRoute("/_layout/_authenticated/admin/members")({
  head: () => ({
    meta: [{ title: "Team | Admin" }],
  }),
  component: AdminMembersPage,
});

function AdminMembersPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          people · team
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Team
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Agency staff who run this dashboard — invited by email with owner, admin, or member roles.
          Not the same as builders (project workers) or clients (paying customers).
        </p>
      </header>
      <MembersAdminSection />
    </div>
  );
}
