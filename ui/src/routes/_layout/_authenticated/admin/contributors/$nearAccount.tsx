import { ArrowLeftIcon, UserCircleIcon } from "@phosphor-icons/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components";
import { BuilderSummaryPanel } from "@/components/admin/builder-summary-panel";
import { ContributorProfileForm } from "@/components/admin/contributors-section";
import { AdminSectionError, AdminSectionSkeleton } from "@/components/admin-section-states";
import { BuilderAvatar } from "@/components/builder-avatar";
import { PageHeader } from "@/components/page-header";
import { formatTokenAmount } from "@/lib/format-amount";
import {
  adminAssignmentsListQueryOptions,
  adminContributorBillingsQueryKey,
  adminContributorDetailQueryOptions,
  adminProjectsListQueryOptions,
} from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/admin/contributors/$nearAccount")({
  head: ({ params }) => ({
    meta: [{ title: `${params.nearAccount} | Admin · Builders` }],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      adminContributorDetailQueryOptions(context.apiClient, params.nearAccount),
    ),
  pendingComponent: () => <AdminSectionSkeleton rows={6} />,
  errorComponent: ({ error, reset }) => {
    if (error.message?.toLowerCase().includes("not found")) {
      return (
        <Empty variant="outline">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserCircleIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>
              <h1>Builder not found</h1>
            </EmptyTitle>
            <EmptyDescription>
              No builder or assignment exists for this NEAR account.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/contributors">
                <ArrowLeftIcon data-icon="inline-start" aria-hidden />
                All builders
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      );
    }
    return <AdminSectionError error={error} onRetry={reset} />;
  },
  component: ContributorDetailPage,
});

function ContributorDetailPage() {
  const { nearAccount } = Route.useParams();
  const apiClient = Route.useRouteContext().apiClient;
  const contributorQuery = useQuery(adminContributorDetailQueryOptions(apiClient, nearAccount));
  const contributor = contributorQuery.data?.contributor;
  const hasContributor = Boolean(contributor);

  const projectsQuery = useQuery({
    ...adminProjectsListQueryOptions(apiClient),
    enabled: hasContributor,
  });
  const assignmentsQuery = useQuery({
    ...adminAssignmentsListQueryOptions(apiClient),
    enabled: hasContributor,
  });

  const billingsQuery = useInfiniteQuery({
    queryKey: adminContributorBillingsQueryKey(nearAccount),
    queryFn: ({ pageParam }) => apiClient.billings.list({ nearAccount, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: hasContributor,
  });

  if (contributorQuery.isLoading) return <AdminSectionSkeleton rows={6} />;
  if (!contributor) return null;

  const projectById = new Map((projectsQuery.data?.data ?? []).map((p) => [p.id, p]));
  const assignments = (assignmentsQuery.data?.data ?? []).filter(
    (a) => a.nearAccount === nearAccount,
  );
  const billings = billingsQuery.data?.pages.flatMap((p) => p.data) ?? [];

  const projectColumns: ColumnDef<(typeof assignments)[number]>[] = [
    {
      id: "project",
      header: "Project",
      accessorFn: (row) => projectById.get(row.projectId)?.title ?? row.projectSlug,
      cell: ({ row }) => (
        <Link
          to="/admin/projects/$slug"
          params={{ slug: row.original.projectSlug }}
          className="font-medium hover:underline"
        >
          {row.original.projectTitle}
        </Link>
      ),
    },
    { id: "role", header: "Role", accessorKey: "role" },
  ];

  const billingColumns: ColumnDef<(typeof billings)[number]>[] = [
    {
      id: "proposal",
      header: "Proposal",
      accessorKey: "proposalId",
      cell: ({ row }) => <span className="tabular-nums">#{row.original.proposalId}</span>,
    },
    {
      id: "amount",
      header: "Amount",
      accessorKey: "amount",
      meta: {
        exportValue: (row: (typeof billings)[number]) => formatTokenAmount(row.amount, row.tokenId),
      },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatTokenAmount(row.original.amount, row.original.tokenId)}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      cell: ({ row }) => <Badge variant="outline">{row.original.status}</Badge>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="self-start">
        <Link to="/admin/contributors">
          <ArrowLeftIcon data-icon="inline-start" aria-hidden />
          All builders
        </Link>
      </Button>

      <div className="flex items-start gap-4">
        <BuilderAvatar name={contributor.name} nearAccount={nearAccount} />
        <PageHeader
          className="min-w-0 flex-1"
          title={contributor.name ?? nearAccount}
          description={
            contributor.name
              ? `${nearAccount} · profile, project assignments and billing history.`
              : "Profile, project assignments and billing history."
          }
        />
      </div>

      {contributorQuery.data?.canEdit ? (
        <ContributorProfileForm nearAccount={nearAccount} contributor={contributor} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Builder profiles are global. Only the builder or a platform admin can edit this one.
        </p>
      )}

      <BuilderSummaryPanel billings={billings} projectCount={assignments.length} />

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Projects</h2>
          </CardTitle>
          <CardDescription>
            Projects this builder is assigned to in your Organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={projectColumns}
            data={assignments}
            isLoading={assignmentsQuery.isLoading}
            emptyMessage="Not assigned to any projects"
            csvFilename={`contributor-${nearAccount}-projects`}
            viewId={`contributor-${nearAccount}-projects`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Billings</h2>
          </CardTitle>
          <CardDescription>Every billing recorded for this builder.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={billingColumns}
            data={billings}
            isLoading={billingsQuery.isLoading}
            emptyMessage="No billings for this builder"
            csvFilename={`contributor-${nearAccount}-billings`}
            viewId={`contributor-${nearAccount}-billings`}
          />
        </CardContent>
      </Card>
    </div>
  );
}
