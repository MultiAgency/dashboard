import { createFileRoute } from "@tanstack/react-router";
import { MembersAdminSection } from "@/components/admin/members-section";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_authenticated/admin/members")({
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
        description="People who run this Organization. Builders and clients are listed separately."
      />
      <MembersAdminSection />
    </div>
  );
}
