import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button, Card, CardContent, Empty, EmptyContent, EmptyTitle, Skeleton } from "@/components";
import { BillingsAdminSection } from "@/components/billings-admin-section";
import { ProposalsAdminSection } from "@/components/proposals-admin-section";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import { getRepoUrl } from "@/lib/repo";

export const Route = createFileRoute("/_layout/payouts")({
  head: () => ({
    meta: [
      { title: "Payouts" },
      { name: "description", content: "On-chain payouts from the agency DAO treasury." },
    ],
  }),
  component: PayoutsPage,
});

type ProposalStatus =
  | "InProgress"
  | "Approved"
  | "Rejected"
  | "Removed"
  | "Expired"
  | "Moved"
  | "Failed";

type Proposal = {
  proposalId: string;
  proposer: string;
  description: string;
  status: ProposalStatus;
  tokenId: string;
  receiverId: string;
  amount: string;
  submissionTime: string;
};

function PayoutsPage() {
  const apiClient = useApiClient();
  const { isOperator, isLoaded } = useMeRoles();

  const settingsQuery = useQuery({
    queryKey: ["settings", "public"],
    queryFn: () => apiClient.settings.getPublic(),
    staleTime: 5 * 60_000,
  });

  const proposalsQuery = useInfiniteQuery({
    queryKey: ["proposals", "list"],
    queryFn: ({ pageParam }) => apiClient.proposals.list({ limit: 50, fromIndex: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextFromIndex ?? undefined,
    staleTime: 30_000,
    retry: false,
  });

  const proposals = proposalsQuery.data?.pages.flatMap((p) => p.data) ?? [];
  const hasNext = !!proposalsQuery.hasNextPage;
  const isFetchingNext = proposalsQuery.isFetchingNextPage;

  if (settingsQuery.data?.isPlaceholder) {
    return <UnclaimedState />;
  }

  return (
    <div className="space-y-12 pb-12 animate-fade-in">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          agency · payouts
        </div>
        <h1 className="font-display text-4xl sm:text-6xl font-black uppercase leading-none tracking-tight">
          Payouts
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Every payout is a transfer proposal — voted and signed publicly on the agency's Sputnik
          DAO contract. Live from chain.
        </p>
      </header>

      {proposalsQuery.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <ProposalCardSkeleton key={i} />
          ))}
        </div>
      ) : proposalsQuery.isError ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          could not load — try again
        </p>
      ) : proposals.length > 0 ? (
        <div className="space-y-3">
          {proposals.map((p) => (
            <ProposalCard key={p.proposalId} proposal={p} />
          ))}
          {hasNext && (
            <div className="flex justify-center pt-2">
              <Button
                onClick={() => proposalsQuery.fetchNextPage()}
                disabled={isFetchingNext}
                variant="outline"
                className="font-display uppercase tracking-wide"
              >
                {isFetchingNext ? "loading..." : "load more →"}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Empty className="border-2 border-dashed border-border/40">
          <EmptyTitle className="font-display text-2xl uppercase tracking-tight text-muted-foreground">
            no payouts yet
          </EmptyTitle>
          <EmptyContent>
            <Button asChild variant="outline" className="font-display uppercase tracking-wide">
              <Link to="/work">view active projects →</Link>
            </Button>
          </EmptyContent>
        </Empty>
      )}

      {isLoaded && isOperator && (
        <>
          <section className="space-y-6">
            <div className="space-y-2">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                operator · payouts
              </div>
              <h2 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
                Map Payouts to Projects
              </h2>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Assign transfer proposals to projects to record them as billings. Unmapped payouts
                show first; the assign flow records the billing without firing anything on-chain.
              </p>
            </div>
            <ProposalsAdminSection />
          </section>

          <section className="space-y-6">
            <div className="space-y-2">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                operator · billings
              </div>
              <h2 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
                Billings Audit
              </h2>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Cross-project view of billings. One billing per Sputnik DAO Transfer proposal;
                status reflects on-chain state at read time.
              </p>
            </div>
            <BillingsAdminSection />
          </section>
        </>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<ProposalStatus, string> = {
  InProgress: "open",
  Approved: "approved",
  Rejected: "rejected",
  Removed: "removed",
  Expired: "expired",
  Moved: "moved",
  Failed: "failed",
};

function ProposalCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-12" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <div className="space-y-1">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </CardContent>
    </Card>
  );
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const submitted = new Date(Number(BigInt(proposal.submissionTime) / 1_000_000n))
    .toISOString()
    .slice(0, 10);
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="truncate">#{proposal.proposalId}</span>
          <span>{STATUS_LABEL[proposal.status] ?? proposal.status}</span>
        </div>
        <p className="text-sm leading-relaxed break-words">{proposal.description}</p>
        <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground space-y-1">
          <div>
            transfer ·{" "}
            <span className="tabular-nums">
              {formatTokenAmount(proposal.amount, proposal.tokenId)}
            </span>
          </div>
          <div className="break-all">to · {proposal.receiverId}</div>
          <div className="break-all">by · {proposal.proposer}</div>
          <div>submitted · {submitted}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function UnclaimedState() {
  return (
    <div className="space-y-12 pb-12 animate-fade-in">
      <section className="pt-8 sm:pt-16">
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            template instance · unclaimed
          </div>
          <h1 className="font-display text-5xl font-black uppercase leading-none tracking-tight sm:text-7xl">
            Payouts
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            This dashboard hasn't been pointed at a Sputnik DAO yet. Once configured, every payout
            will appear here live from the contract.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button asChild className="font-display uppercase tracking-wide">
              <a href={getRepoUrl()} target="_blank" rel="noopener noreferrer">
                clone the template →
              </a>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
