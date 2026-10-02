import { ArrowLeftIcon } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components";
import { SharedProjectDetail } from "@/components/client/shared-project-detail";

export const Route = createFileRoute("/_layout/_authenticated/client/$engagementId/projects/$slug")(
  {
    component: SharedProjectPage,
  },
);

function SharedProjectPage() {
  const { slug } = Route.useParams();
  const { engagement } = Route.useRouteContext();
  return (
    <SharedProjectDetail
      engagement={engagement}
      slug={slug}
      back={
        <Button asChild size="sm" variant="ghost" className="w-fit">
          <Link to="/client/$engagementId/projects" params={{ engagementId: engagement.id }}>
            <ArrowLeftIcon data-icon="inline-start" aria-hidden />
            Shared Projects
          </Link>
        </Button>
      }
    />
  );
}
