import { ArrowRightIcon, FileTextIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  PageHeader,
  Skeleton,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { useApiClient } from "@/lib/api";
import { canReadEngagement } from "@/lib/navigation";
import { engagementsListQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/client/reports")({
  head: () => ({
    meta: [
      { title: "Reports" },
      { name: "description", content: "Spend, billings and builders for your Projects." },
    ],
  }),
  beforeLoad: async ({ context }) => {
    const engagements = await context.queryClient
      .ensureQueryData(engagementsListQueryOptions(context.apiClient))
      .catch(() => null);
    const readable = (engagements?.data ?? []).filter(
      (e) => e.side === "client" && canReadEngagement(e.status),
    );
    if (readable.length === 1) {
      throw redirect({
        to: "/client/$engagementId/reports",
        params: { engagementId: readable[0]!.id },
      });
    }
  },
  component: ClientReportsIndex,
});

function ClientReportsIndex() {
  const apiClient = useApiClient();
  const engagementsQuery = useQuery(engagementsListQueryOptions(apiClient));
  const engagements = (engagementsQuery.data?.data ?? []).filter(
    (e) => e.side === "client" && canReadEngagement(e.status),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description="Generate a report of budget, spend, billings and builders for the Projects an Agency shares with you, then download it as CSV."
      />
      {engagementsQuery.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : engagementsQuery.isError ? (
        <AdminError error={engagementsQuery.error} />
      ) : engagements.length === 0 ? (
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
        <ItemGroup>
          {engagements.map((engagement) => (
            <li key={engagement.id}>
              <Item variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>{engagement.agency.name}</ItemTitle>
                  <ItemDescription>
                    {engagement.projectIds.length}{" "}
                    {engagement.projectIds.length === 1 ? "shared Project" : "shared Projects"}
                    {engagement.status === "ended" ? " · ended" : ""}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button asChild size="sm" variant="outline">
                    <Link
                      to="/client/$engagementId/reports"
                      params={{ engagementId: engagement.id }}
                    >
                      Open reports
                      <ArrowRightIcon data-icon="inline-end" aria-hidden />
                    </Link>
                  </Button>
                </ItemActions>
              </Item>
            </li>
          ))}
        </ItemGroup>
      )}
    </div>
  );
}
