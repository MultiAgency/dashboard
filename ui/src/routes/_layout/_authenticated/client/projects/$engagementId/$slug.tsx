import { ArrowLeftIcon } from "@phosphor-icons/react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Button } from "@/components";
import { SharedProjectDetail } from "@/components/client/shared-project-detail";
import { canReadEngagement } from "@/lib/navigation";
import { engagementDetailQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/client/projects/$engagementId/$slug")(
  {
    beforeLoad: async ({ context, params }) => {
      const engagement = await context.queryClient
        .ensureQueryData(engagementDetailQueryOptions(context.apiClient, params.engagementId))
        .catch(() => null);
      if (!engagement || engagement.side !== "client" || !canReadEngagement(engagement.status)) {
        throw redirect({ to: "/client/projects" });
      }
      return { engagement };
    },
    component: ClientProjectPage,
  },
);

function ClientProjectPage() {
  const { slug } = Route.useParams();
  const { engagement } = Route.useRouteContext();
  return (
    <SharedProjectDetail
      engagement={engagement}
      slug={slug}
      back={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button asChild size="sm" variant="ghost" className="w-fit">
            <Link to="/client/projects">
              <ArrowLeftIcon data-icon="inline-start" aria-hidden />
              Projects
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/client/reports" search={{ agency: engagement.id }}>
              Reports for {engagement.agency.name}
            </Link>
          </Button>
        </div>
      }
    />
  );
}
