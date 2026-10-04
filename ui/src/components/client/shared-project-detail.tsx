import { useQuery } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  SectionHeader,
  Skeleton,
} from "@/components";
import { AssignmentsSection } from "@/components/admin/assignments-section";
import { BillingsAdminSection } from "@/components/admin/billings-section";
import { ProjectBillingsSection } from "@/components/admin/project-billings";
import { ProjectBudgetPanel } from "@/components/admin/project-budget-panel";
import { ConnectTreasuryPrompt } from "@/components/connect-treasury-prompt";
import type { EngagementView } from "@/components/engagement-status";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { clientPortalProjectDetailQueryOptions } from "@/lib/queries";

export function SharedProjectDetail({
  engagement,
  slug,
  back,
}: {
  engagement: EngagementView;
  slug: string;
  back: ReactNode | ((project: { id: string; title: string }) => ReactNode);
}) {
  const apiClient = useApiClient();
  const { agencyDao, isLoaded } = useMeRoles();
  const projectQuery = useQuery(
    clientPortalProjectDetailQueryOptions(apiClient, engagement.id, slug),
  );
  const subcontract = engagement.kind === "subcontract";
  const working = subcontract && engagement.status === "active";

  if (projectQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <span className="sr-only">Loading Project</span>
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (projectQuery.isError || !projectQuery.data) {
    throw notFound();
  }

  const { project, contributors } = projectQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {typeof back === "function" ? back(project) : back}
        <SectionHeader
          title={project.title}
          description={
            <span className="flex flex-wrap items-center gap-2">
              <span>@{project.slug}</span>
              <Badge variant="outline">{project.status}</Badge>
              <Badge variant="outline">{project.kind}</Badge>
            </span>
          }
        />
      </div>

      {project.description && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{project.description}</p>
          </CardContent>
        </Card>
      )}

      {subcontract && <AssignmentsSection projectId={project.id} readOnly={!working} />}

      {!subcontract && contributors && contributors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Builders</CardTitle>
            <CardDescription>Who works on this Project.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {contributors.map((c) => (
                <li key={c.nearAccount} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{c.name}</span>
                  {c.role && <span className="text-muted-foreground">{c.role}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <ProjectBudgetPanel projectId={project.id} readOnly engagementId={engagement.id} />

      {working && isLoaded && !agencyDao && <ConnectTreasuryPrompt />}

      {working && agencyDao ? (
        <ProjectBillingsSection projectId={project.id} contributors={contributors ?? []} />
      ) : (
        <BillingsAdminSection readOnly engagementId={engagement.id} fixedProjectId={project.id} />
      )}
    </div>
  );
}
