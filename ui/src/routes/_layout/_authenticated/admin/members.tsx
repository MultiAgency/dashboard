import { createFileRoute } from "@tanstack/react-router";
import { MembersAdminSection } from "@/components/admin/members-section";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_layout/_authenticated/admin/members")({
  head: () => ({
    meta: [{ title: "Team | Admin" }],
  }),
  component: AdminMembersPage,
});

function AdminMembersPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description="People in this Organization, invited by email as owner, admin or member. Not the same as builders (project workers) or clients (paying customers)."
      />
      <MembersAdminSection />
    </div>
  );
}
