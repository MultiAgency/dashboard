import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, DataTable } from "@/components";
import { BuilderSummaryPanel } from "@/components/admin/builder-summary-panel";
import { ContributorProfileForm } from "@/components/admin/contributors-section";
import { AdminSectionError, AdminSectionSkeleton } from "@/components/admin-section-states";
import { BuilderAvatar } from "@/components/builder-avatar";
import { formatTokenAmount } from "@/lib/format-amount";
import {
  adminAssignmentsListQueryOptions,
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
        <div className="space-y-3 py-8">
          <h1 className="font-display text-2xl font-black uppercase">Builder not found</h1>
          <p className="text-sm text-muted-foreground">
            No builder or assignment exists for this NEAR account.
          </p>
          <Link to="/admin/contributors" className="text-sm underline">
            ← all builders
          </Link>
        </div>
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
  if (contributorQuery.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!contributor) return null;

  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));
  const assignmentsQuery = useQuery(adminAssignmentsListQueryOptions(apiClient));

  const billingsQuery = useInfiniteQuery({
    queryKey: ["admin", "billings", "contributor", nearAccount],
    queryFn: ({ pageParam }) => apiClient.billings.list({ nearAccount, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

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
          className="text-sm underline"
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
      cell: ({ row }) => <span className="font-mono text-xs">#{row.original.proposalId}</span>,
    },
    {
      id: "amount",
      header: "Amount",
      accessorKey: "amount",
      meta: {
        exportValue: (row: (typeof billings)[number]) => formatTokenAmount(row.amount, row.tokenId),
      },
      cell: ({ row }) => (
        <span className="font-mono text-sm">
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
    <div className="space-y-8">
      <div>
        <Link
          to="/admin/contributors"
          className="text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          ← all builders
        </Link>
      </div>

      <header className="flex flex-wrap items-start gap-4">
        <BuilderAvatar name={contributor.name} nearAccount={nearAccount} />
        <div className="space-y-2 min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            people · builders
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
            {contributor.name ?? nearAccount}
          </h1>
          <p className="font-mono text-sm text-muted-foreground">{nearAccount}</p>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Builder profile, project assignments, and billing history.
          </p>
        </div>
      </header>

      <ContributorProfileForm nearAccount={nearAccount} contributor={contributor} />

      <BuilderSummaryPanel billings={billings} projectCount={assignments.length} />

      <section className="space-y-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          projects
        </h2>
        <DataTable
          columns={projectColumns}
          data={assignments}
          isLoading={assignmentsQuery.isLoading}
          emptyMessage="Not assigned to any projects."
          csvFilename={`contributor-${nearAccount}-projects`}
          viewId={`contributor-${nearAccount}-projects`}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          billings
        </h2>
        <DataTable
          columns={billingColumns}
          data={billings}
          isLoading={billingsQuery.isLoading}
          emptyMessage="No billings for this builder."
          csvFilename={`contributor-${nearAccount}-billings`}
          viewId={`contributor-${nearAccount}-billings`}
        />
      </section>
    </div>
  );
}
