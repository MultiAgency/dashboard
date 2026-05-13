import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty, Field, Loading, selectClass } from "@/components/admin-form";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
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

function formatSubmissionDate(nanoseconds: string): string {
  const ms = Number(nanoseconds) / 1_000_000;
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

type ProposalRow = {
  proposalId: string;
  proposer: string;
  description: string;
  status: ProposalStatus;
  tokenId: string;
  receiverId: string;
  amount: string;
  submissionTime: string;
  mapping: {
    billingId: string;
    projectId: string;
    projectSlug: string;
    projectTitle: string;
  } | null;
};

type ProjectSummary = { id: string; slug: string; title: string };

export function ProposalsAdminSection() {
  const apiClient = useApiClient();
  const [showOnlyUnmapped, setShowOnlyUnmapped] = useState(true);

  const proposalsQuery = useInfiniteQuery({
    queryKey: ["admin", "proposals", "list"],
    queryFn: ({ pageParam }) =>
      apiClient.proposals.adminList(pageParam ? { fromIndex: pageParam } : {}),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextFromIndex ?? undefined,
    refetchOnWindowFocus: false,
  });
  const projectsQuery = useQuery({
    queryKey: ["admin", "projects", "list"],
    queryFn: () => apiClient.agency.projects.adminList(),
    retry: false,
  });
  const settingsQuery = useQuery({
    queryKey: ["settings", "adminGet"],
    queryFn: () => apiClient.settings.adminGet(),
  });
  const daoAccountId = settingsQuery.data?.settings.daoAccountId ?? null;

  if (proposalsQuery.isError) {
    return <AdminError error={proposalsQuery.error} />;
  }

  const lastProposalId = proposalsQuery.data?.pages[0]?.lastProposalId ?? null;
  const proposals = (proposalsQuery.data?.pages.flatMap((p) => p.data) ?? []) as ProposalRow[];
  const projects: ProjectSummary[] = (projectsQuery.data?.data ?? []).map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
  }));

  const filtered = showOnlyUnmapped ? proposals.filter((p) => !p.mapping) : proposals;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5 flex items-center gap-3">
          <input
            id="filter-unmapped"
            type="checkbox"
            checked={showOnlyUnmapped}
            onChange={(e) => setShowOnlyUnmapped(e.target.checked)}
            className="size-4"
          />
          <label htmlFor="filter-unmapped" className="text-sm">
            show only unmapped
          </label>
          <span className="ml-auto text-xs font-mono text-muted-foreground">
            {lastProposalId !== null ? `last id ${lastProposalId}` : ""}
          </span>
        </CardContent>
      </Card>

      {proposalsQuery.isLoading ? (
        <Loading label="Loading proposals..." />
      ) : filtered.length > 0 ? (
        <>
          <div className="space-y-3">
            {filtered.map((p) => (
              <ProposalCard
                key={p.proposalId}
                proposal={p}
                projects={projects}
                daoAccountId={daoAccountId}
              />
            ))}
          </div>
          {proposalsQuery.hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => proposalsQuery.fetchNextPage()}
                disabled={proposalsQuery.isFetchingNextPage}
              >
                {proposalsQuery.isFetchingNextPage ? "loading..." : "load older"}
              </Button>
            </div>
          )}
        </>
      ) : (
        <Empty
          label={
            showOnlyUnmapped
              ? "All recent Transfer proposals are mapped to projects."
              : "No Transfer proposals found on the DAO."
          }
        />
      )}
    </div>
  );
}

function ProposalCard({
  proposal,
  projects,
  daoAccountId,
}: {
  proposal: ProposalRow;
  projects: ProjectSummary[];
  daoAccountId: string | null;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");

  const assignMutation = useMutation({
    mutationFn: async () =>
      apiClient.billings.adminCreate({
        projectId,
        proposalId: proposal.proposalId,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "proposals", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "billings", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "projects", "budget"] }),
      ]);
      toast.success(`Proposal #${proposal.proposalId} assigned`);
    },
    onError: (err: Error) => toast.error(err.message || "Failed to assign proposal"),
  });

  const isPending = assignMutation.isPending;
  const canAssign = projectId !== "" && !isPending && !proposal.mapping;

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusBadgeVariant(proposal.status)}>{proposal.status}</Badge>
          {daoAccountId && (
            <a
              href={trezuProposalUrl(daoAccountId, proposal.proposalId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-muted-foreground hover:text-foreground underline"
            >
              proposal #{proposal.proposalId} ↗
            </a>
          )}
          {proposal.mapping ? (
            <Badge variant="default" className="ml-auto">
              <Link
                to="/admin/projects/$slug"
                params={{ slug: proposal.mapping.projectSlug }}
                className="font-mono"
              >
                @{proposal.mapping.projectSlug}
              </Link>
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto">
              unmapped
            </Badge>
          )}
        </div>
        <div className="font-mono text-sm break-all">
          <span className="tabular-nums">
            {formatTokenAmount(proposal.amount, proposal.tokenId)}
          </span>{" "}
          → {proposal.receiverId}
        </div>
        <div className="text-xs text-muted-foreground">
          filed {formatSubmissionDate(proposal.submissionTime)} by {proposal.proposer}
        </div>
        {proposal.description && (
          <div className="text-xs text-muted-foreground italic line-clamp-2">
            {proposal.description}
          </div>
        )}

        {!proposal.mapping && projects.length > 0 && (
          <div className="flex items-end gap-2 pt-1">
            <Field label="assign to project" htmlFor={`assign-project-${proposal.proposalId}`}>
              <select
                id={`assign-project-${proposal.proposalId}`}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={isPending}
                className={selectClass}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </Field>
            <Button size="sm" onClick={() => assignMutation.mutate()} disabled={!canAssign}>
              {isPending ? "assigning..." : "assign"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
