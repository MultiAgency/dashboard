import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { ChoiceSelect } from "@/components/admin-form";
import {
  buildBillingFilterGraph,
  reconcileBillingFilters,
  resolveBillingFilterDropdownOptions,
} from "@/lib/admin-filter-graph";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import {
  adminAssignmentsListQueryOptions,
  adminBillingsQueryKey,
  adminContributorsListQueryOptions,
  adminProjectsListQueryOptions,
  clientBillingsQueryKey,
  clientPortalProjectsListQueryOptions,
  sharedWithUsQueryOptions,
} from "@/lib/queries";

type Billing = Awaited<ReturnType<ApiClient["billings"]["list"]>>["data"][number];

type BillingsAdminSectionProps = {
  readOnly?: boolean;
  engagementId?: string;
  fixedProjectId?: string;
};

export function BillingsAdminSection({
  readOnly = false,
  engagementId,
  fixedProjectId,
}: BillingsAdminSectionProps) {
  const apiClient = useApiClient();
  const clientPortal = engagementId !== undefined;
  const [projectId, setProjectId] = useState(fixedProjectId ?? "");
  const [nearAccount, setNearAccount] = useState("");

  const adminProjectsQuery = useQuery({
    ...adminProjectsListQueryOptions(apiClient),
    enabled: !clientPortal,
  });
  const clientProjectsQuery = useQuery({
    ...clientPortalProjectsListQueryOptions(apiClient, engagementId ?? ""),
    enabled: clientPortal,
  });
  const projectsQuery = clientPortal ? clientProjectsQuery : adminProjectsQuery;
  const contributorsQuery = useQuery({
    ...adminContributorsListQueryOptions(apiClient),
    enabled: !clientPortal,
  });
  const assignmentsQuery = useQuery({
    ...adminAssignmentsListQueryOptions(apiClient),
    enabled: !clientPortal,
  });
  const sharedWithUsQuery = useQuery({
    ...sharedWithUsQueryOptions(apiClient),
    enabled: !clientPortal,
  });
  const engagementOfShared = new Map(
    (sharedWithUsQuery.data?.data ?? []).map((s) => [s.project.id, s.engagementId]),
  );

  const billingsQuery = useInfiniteQuery({
    queryKey: engagementId
      ? clientBillingsQueryKey(engagementId, projectId || null)
      : adminBillingsQueryKey({ projectId: projectId || null, nearAccount: nearAccount || null }),
    queryFn: ({ pageParam }) =>
      engagementId
        ? apiClient.clientPortal.billings.list({
            engagementId,
            projectId: projectId || undefined,
            cursor: pageParam,
          })
        : apiClient.billings.list({
            projectId: projectId || undefined,
            nearAccount: nearAccount || undefined,
            cursor: pageParam,
          }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });

  const billings = useMemo(
    () => billingsQuery.data?.pages.flatMap((p) => p.data) ?? [],
    [billingsQuery.data],
  );
  const projects = useMemo(
    () => [
      ...(projectsQuery.data?.data ?? []),
      ...(clientPortal ? [] : (sharedWithUsQuery.data?.data ?? []).map((s) => s.project)),
    ],
    [projectsQuery.data, sharedWithUsQuery.data, clientPortal],
  );
  const allContributors = contributorsQuery.data?.data ?? [];

  const filterGraph = useMemo(
    () =>
      buildBillingFilterGraph({
        projectIds: projects.map((p) => p.id),
        assignments: assignmentsQuery.data?.data ?? [],
        billingLinks: billings.map((b) => ({
          projectId: b.projectId,
          nearAccount: b.nearAccount,
        })),
      }),
    [projects, assignmentsQuery.data?.data, billings],
  );

  const allProjectIds = useMemo(() => projects.map((p) => p.id), [projects]);
  const allContributorAccounts = useMemo(
    () => allContributors.map((c) => c.nearAccount),
    [allContributors],
  );

  const dropdownOptions = useMemo(
    () =>
      resolveBillingFilterDropdownOptions(filterGraph, allProjectIds, allContributorAccounts, {
        projectId,
        nearAccount,
      }),
    [filterGraph, allProjectIds, allContributorAccounts, projectId, nearAccount],
  );

  const filterProjects = useMemo(
    () => projects.filter((p) => dropdownOptions.projects.has(p.id)),
    [projects, dropdownOptions.projects],
  );

  const applyFilters = (patch: Partial<{ projectId: string; nearAccount: string }>) => {
    const next = reconcileBillingFilters(
      { projectId, nearAccount },
      patch,
      filterGraph,
      allProjectIds,
      allContributorAccounts,
    );
    setProjectId(next.projectId);
    setNearAccount(next.nearAccount);
  };

  const contributorOptions = useMemo(() => {
    const byNear = new Map(allContributors.map((c) => [c.nearAccount, c]));
    for (const b of billings) {
      if (b.nearAccount && !byNear.has(b.nearAccount)) {
        byNear.set(b.nearAccount, {
          nearAccount: b.nearAccount,
          name: null,
          bio: null,
          skills: [],
          location: null,
          links: null,
          registered: false,
          createdAt: "",
          updatedAt: "",
        });
      }
    }
    return [...byNear.values()].filter((c) => dropdownOptions.contributors.has(c.nearAccount));
  }, [allContributors, billings, dropdownOptions.contributors]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const contributorByNear = new Map(contributorOptions.map((c) => [c.nearAccount, c]));
  const filtersActive = projectId !== "" || nearAccount !== "";

  if (billingsQuery.isError) {
    return <AdminError error={billingsQuery.error} />;
  }

  const projectCell = ({ row }: { row: { original: Billing } }) => {
    const project = projectById.get(row.original.projectId);
    if (!project) {
      return <span className="text-muted-foreground">{row.original.projectId}</span>;
    }
    const sharedThrough = engagementId ?? engagementOfShared.get(project.id);
    if (sharedThrough) {
      return (
        <Link
          to="/client/$engagementId/projects/$slug"
          params={{ engagementId: sharedThrough, slug: project.slug }}
          className="font-medium hover:underline"
        >
          {project.title}
        </Link>
      );
    }
    return (
      <Link
        to="/admin/projects/$slug"
        params={{ slug: project.slug }}
        className="font-medium hover:underline"
      >
        {project.title}
      </Link>
    );
  };

  const contributorCell = ({ row }: { row: { original: Billing } }) => {
    const near = row.original.nearAccount;
    if (!near) return <span className="text-muted-foreground">—</span>;
    const c = contributorByNear.get(near);
    const label = c?.name ?? near;
    if (clientPortal) {
      return <span>{label}</span>;
    }
    return (
      <Link
        to="/admin/contributors/$nearAccount"
        params={{ nearAccount: near }}
        className="hover:underline"
      >
        {label}
      </Link>
    );
  };

  const columns: ColumnDef<Billing>[] = [
    {
      id: "proposalId",
      header: "Proposal",
      accessorKey: "proposalId",
      cell: ({ row }) => <span className="tabular-nums">#{row.original.proposalId}</span>,
    },
    {
      id: "project",
      header: "Project",
      accessorFn: (row) => projectById.get(row.projectId)?.title ?? row.projectId,
      cell: projectCell,
    },
    {
      id: "contributor",
      header: clientPortal ? "Builder" : "Contributor",
      accessorFn: (row) =>
        row.nearAccount ? (contributorByNear.get(row.nearAccount)?.name ?? row.nearAccount) : "",
      cell: contributorCell,
    },
    {
      id: "amount",
      header: "Amount",
      accessorKey: "amount",
      meta: {
        exportValue: (row: Billing) => formatTokenAmount(row.amount, row.tokenId),
      },
      cell: ({ row }) => (
        <span className="font-medium tabular-nums">
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
    {
      id: "payingDao",
      header: "Paid from",
      accessorKey: "payingDaoAccountId",
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.payingDaoAccountId || "—"}</span>
      ),
    },
    {
      id: "createdAt",
      header: "Created",
      accessorFn: (row) => new Date(row.createdAt).toISOString(),
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums">
          {new Date(row.original.createdAt).toISOString().slice(0, 10)}
        </span>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{clientPortal ? "Billings" : "All billings"}</h2>
        </CardTitle>
        <CardDescription>
          {clientPortal
            ? "Payouts recorded on the shared projects."
            : "Payouts across your projects and projects shared with you."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!readOnly && !clientPortal && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-full sm:w-48">
              <ChoiceSelect
                id="filter-project"
                ariaLabel="Project"
                size="sm"
                value={projectId}
                onValueChange={(value) => applyFilters({ projectId: value })}
                emptyLabel="All projects"
                options={filterProjects.map((p) => ({ value: p.id, label: p.title }))}
              />
            </div>
            <div className="w-full sm:w-48">
              <ChoiceSelect
                id="filter-contributor"
                ariaLabel="Builder"
                size="sm"
                value={nearAccount}
                onValueChange={(value) => applyFilters({ nearAccount: value })}
                emptyLabel="All builders"
                options={contributorOptions.map((c) => ({
                  value: c.nearAccount,
                  label: c.name ?? c.nearAccount,
                }))}
              />
            </div>
            {filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => applyFilters({ projectId: "", nearAccount: "" })}
              >
                Reset filters
              </Button>
            )}
          </div>
        )}

        <DataTable
          columns={columns}
          data={billings}
          isLoading={billingsQuery.isLoading}
          error={billingsQuery.error}
          onRetry={() => billingsQuery.refetch()}
          emptyMessage={
            filtersActive ? "No billings match these filters" : "No billings recorded yet"
          }
          csvFilename="billings"
          viewId={clientPortal ? "client-billings" : "admin-billings"}
          searchPlaceholder="Search billings…"
          readOnly={readOnly}
        />

        {billingsQuery.hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => billingsQuery.fetchNextPage()}
              disabled={billingsQuery.isFetchingNextPage}
            >
              {billingsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
