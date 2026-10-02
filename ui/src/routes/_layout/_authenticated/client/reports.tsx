import { FileTextIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { ClientReports } from "@/components/client/client-reports";
import { useApiClient } from "@/lib/api";
import { canReadEngagement } from "@/lib/navigation";
import { engagementsListQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/client/reports")({
  validateSearch: z.object({
    agency: z.string().optional().catch(undefined),
    project: z.string().optional().catch(undefined),
    report: z.string().optional().catch(undefined),
  }),
  head: () => ({
    meta: [
      { title: "Reports" },
      { name: "description", content: "Spend, billings and builders for your Projects." },
    ],
  }),
  component: ClientReportsIndex,
});

function ClientReportsIndex() {
  const apiClient = useApiClient();
  const navigate = Route.useNavigate();
  const { agency, project, report } = Route.useSearch();
  const engagementsQuery = useQuery(engagementsListQueryOptions(apiClient));
  const engagements = (engagementsQuery.data?.data ?? []).filter(
    (e) => e.side === "client" && canReadEngagement(e.status),
  );
  const selected = engagements.find((e) => e.id === agency) ?? engagements[0];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description="Budget, spend, billings and builders for the Projects an Agency shares with you."
        actions={
          engagements.length > 1 &&
          selected && (
            <Select
              value={selected.id}
              onValueChange={(id) => void navigate({ search: { agency: id } })}
            >
              <SelectTrigger aria-label="Agency" className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {engagements.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.agency.name}
                    {e.status === "ended" ? " (ended)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }
      />
      {engagementsQuery.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : engagementsQuery.isError ? (
        <AdminError error={engagementsQuery.error} />
      ) : !selected ? (
        <Empty variant="outline">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileTextIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No reports yet</EmptyTitle>
            <EmptyDescription>
              Reports appear once an Agency shares Projects with you.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ClientReports
          key={selected.id}
          engagement={selected}
          reportId={report}
          initialProjectId={project}
          onOpenReport={(id) => void navigate({ search: { agency: selected.id, report: id } })}
        />
      )}
    </div>
  );
}
