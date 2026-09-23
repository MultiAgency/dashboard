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
          People in this Organization, invited by email or approved through a join request. Owners
          and admins manage the team; members can view their shared work.
        </p>
      </header>
      <MembersAdminSection />
    </div>
  );
}
