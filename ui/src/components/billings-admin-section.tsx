import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, CardContent } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty, Field, Loading, selectClass } from "@/components/admin-form";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import {
  adminContributorsListQueryOptions,
  adminProjectsListQueryOptions,
  adminSettingsQueryOptions,
} from "@/lib/queries";
import { trezuProposalUrl } from "@/lib/trezu";

type ProposalStatus =
  | "InProgress"
  | "Approved"
  | "Rejected"
  | "Removed"
  | "Expired"
  | "Moved"
  | "Failed";

const TERMINAL_FAIL: ReadonlySet<ProposalStatus> = new Set([
  "Rejected",
  "Removed",
  "Expired",
  "Moved",
  "Failed",
]);

function statusBadgeVariant(status: ProposalStatus): "default" | "outline" | "destructive" {
  if (status === "Approved") return "default";
  if (TERMINAL_FAIL.has(status)) return "destructive";
  return "outline";
}

type Billing = {
  id: string;
  projectId: string;
  contributorId: string | null;
  tokenId: string;
  amount: string;
  status: ProposalStatus;
  proposalId: string;
  note: string | null;
  createdAt: Date;
};

type ProjectSummary = { id: string; slug: string; title: string };
type ContributorSummary = { id: string; name: string };

export function BillingsAdminSection() {
  const apiClient = useApiClient();

  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));
  const contributorsQuery = useQuery(adminContributorsListQueryOptions(apiClient));
  const settingsQuery = useQuery(adminSettingsQueryOptions(apiClient));
  const daoAccountId = settingsQuery.data?.settings.daoAccountId ?? null;

  const [filterProject, setFilterProject] = useState<string>("");
  const [filterContributor, setFilterContributor] = useState<string>("");

  const billingsQuery = useInfiniteQuery({
    queryKey: ["admin", "billings", "list", filterProject || null, filterContributor || null],
    queryFn: ({ pageParam }) =>
      apiClient.billings.adminList({
        projectId: filterProject || undefined,
        contributorId: filterContributor || undefined,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const billings = billingsQuery.data?.pages.flatMap((p) => p.data) ?? [];

  if (projectsQuery.isError) {
    return <AdminError error={projectsQuery.error} />;
  }

  const projects: ProjectSummary[] = (projectsQuery.data?.data ?? []).map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
  }));
  const contributors: ContributorSummary[] = (contributorsQuery.data?.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const contributorById = new Map(contributors.map((c) => [c.id, c]));

  const filtersActive = filterProject !== "" || filterContributor !== "";

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5 grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="project" htmlFor="filter-project">
            <select
              id="filter-project"
              value={filterProject}
              onChange={(e) => setFilterProject(e.target.value)}
              className={selectClass}
            >
              <option value="">all projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="contributor" htmlFor="filter-contributor">
            <select
              id="filter-contributor"
              value={filterContributor}
              onChange={(e) => setFilterContributor(e.target.value)}
              className={selectClass}
            >
              <option value="">all contributors</option>
              {contributors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <Button
              variant="outline"
              size="sm"
              disabled={!filtersActive}
              onClick={() => {
                setFilterProject("");
                setFilterContributor("");
              }}
            >
              reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {billingsQuery.isLoading ? (
        <Loading label="Loading billings..." />
      ) : billings.length > 0 ? (
        <>
          <div className="space-y-3">
            {billings.map((b) => (
              <BillingRow
                key={b.id}
                billing={b}
                project={projectById.get(b.projectId)}
                contributor={b.contributorId ? contributorById.get(b.contributorId) : undefined}
                daoAccountId={daoAccountId}
              />
            ))}
          </div>
          {billingsQuery.hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => billingsQuery.fetchNextPage()}
                disabled={billingsQuery.isFetchingNextPage}
              >
                {billingsQuery.isFetchingNextPage ? "loading..." : "load more"}
              </Button>
            </div>
          )}
        </>
      ) : (
        <Empty
          label={
            filtersActive ? "No billings match the current filters." : "No billings recorded yet."
          }
        />
      )}
    </div>
  );
}

function BillingRow({
  billing,
  project,
  contributor,
  daoAccountId,
}: {
  billing: Billing;
  project?: ProjectSummary;
  contributor?: ContributorSummary;
  daoAccountId: string | null;
}) {
  return (
    <Card>
      <CardContent className="p-5 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusBadgeVariant(billing.status)}>{billing.status}</Badge>
          {project && (
            <span className="text-xs font-mono text-muted-foreground">@{project.slug}</span>
          )}
          {daoAccountId && (
            <a
              href={trezuProposalUrl(daoAccountId, billing.proposalId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-muted-foreground hover:text-foreground underline"
            >
              proposal #{billing.proposalId} ↗
            </a>
          )}
        </div>
        <div className="font-mono tabular-nums text-sm break-all">
          {formatTokenAmount(billing.amount, billing.tokenId)}
        </div>
        <div className="text-xs text-muted-foreground">
          {contributor ? `to ${contributor.name}` : "project-level"} ·{" "}
          {new Date(billing.createdAt).toISOString().slice(0, 10)}
        </div>
        {billing.note && <div className="text-xs text-muted-foreground italic">{billing.note}</div>}
      </CardContent>
    </Card>
  );
}
