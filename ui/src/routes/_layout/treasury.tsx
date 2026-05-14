import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button, Card, CardContent, Empty, EmptyContent, EmptyTitle, Skeleton } from "@/components";
import { AllocationsManager } from "@/components/allocations-manager";
import { RecentActivitySection } from "@/components/recent-activity-section";
import { UnclaimedState } from "@/components/unclaimed-state";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";

export const Route = createFileRoute("/_layout/treasury")({
  head: () => ({
    meta: [
      { title: "Treasury" },
      { name: "description", content: "On-chain treasury balances of the agency DAO." },
    ],
  }),
  component: TreasuryPage,
});

type Token = {
  tokenId: string;
  network: string;
  symbol: string;
  decimals: number;
  name: string;
  icon: string | null;
};

function TreasuryPage() {
  const apiClient = useApiClient();
  const { isOperator, isAdmin, isLoaded } = useMeRoles();

  const settingsQuery = useQuery({
    queryKey: ["settings", "public"],
    queryFn: () => apiClient.settings.getPublic(),
    staleTime: 5 * 60_000,
  });

  const tokensQuery = useQuery({
    queryKey: ["tokens", "list"],
    queryFn: () => apiClient.tokens.list(),
    staleTime: 60 * 60_000,
    retry: false,
  });

  const tokens = tokensQuery.data?.tokens ?? [];
  const tokenIds = tokens.map((t) => t.tokenId);

  const balancesQuery = useQuery({
    queryKey: ["treasury", "balances", "public", [...tokenIds].sort().join(",")],
    queryFn: () => apiClient.treasury.getPublicBalances({ tokenIds }),
    enabled: tokenIds.length > 0,
    staleTime: 60_000,
    retry: false,
  });

  if (settingsQuery.data?.isPlaceholder) {
    return (
      <UnclaimedState title="Treasury">
        Once configured, on-chain balances appear here live from the contract.
      </UnclaimedState>
    );
  }

  const isLoading = tokensQuery.isLoading || (tokenIds.length > 0 && balancesQuery.isLoading);
  const balanceByToken = new Map(
    (balancesQuery.data?.balances ?? []).map((b) => [b.tokenId, b.balance]),
  );

  return (
    <div className="space-y-12 pb-12 animate-fade-in">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          agency · treasury
        </div>
        <h1 className="font-display text-4xl sm:text-6xl font-black uppercase leading-none tracking-tight">
          Treasury
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Liquid balances live on the agency's Sputnik DAO contract.
        </p>
      </header>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2].map((i) => (
            <TokenCardSkeleton key={i} />
          ))}
        </div>
      ) : tokens.length === 0 ? (
        <Empty className="border-2 border-dashed border-border/40">
          <EmptyTitle className="font-display text-2xl uppercase tracking-tight text-muted-foreground">
            no tokens configured
          </EmptyTitle>
          <EmptyContent>
            <Button asChild variant="outline" className="font-display uppercase tracking-wide">
              <Link to="/payouts">view payouts →</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tokens.map((token) => (
            <TokenCard
              key={token.tokenId}
              token={token}
              balance={balanceByToken.get(token.tokenId) ?? "0"}
            />
          ))}
        </div>
      )}

      {isLoaded && isOperator && (
        <>
          <RecentActivitySection />

          <section className="space-y-6">
            <div className="space-y-2">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                operator · allocations
              </div>
              <h2 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
                Manage Allocations
              </h2>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Move treasury into project budgets. Each allocation is recorded with actor +
                timestamp in the audit log.
              </p>
              {isAdmin && (
                <div className="pt-1">
                  <Link
                    to="/settings"
                    hash="dao"
                    className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground hover:text-foreground"
                  >
                    edit dao config →
                  </Link>
                </div>
              )}
            </div>
            <AllocationsManager />
          </section>
        </>
      )}
    </div>
  );
}

function TokenCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-12" />
        </div>
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-3 w-2/3" />
      </CardContent>
    </Card>
  );
}

function TokenCard({ token, balance }: { token: Token; balance: string }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="truncate">{token.symbol}</span>
          <span>{token.network}</span>
        </div>
        <div className="font-display text-2xl uppercase tracking-tight font-extrabold leading-tight tabular-nums break-words">
          {formatTokenAmount(balance, token.tokenId)}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground break-all">
          {token.name}
        </div>
      </CardContent>
    </Card>
  );
}
