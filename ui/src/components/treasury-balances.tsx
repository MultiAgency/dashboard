import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";

export function TreasuryBalances() {
  const apiClient = useApiClient();
  const tokensQuery = useQuery({
    queryKey: ["admin", "tokens"],
    queryFn: () => apiClient.tokens.list(),
    staleTime: 60 * 60_000,
  });
  const tokens = tokensQuery.data?.tokens ?? [];
  const tokenIds = tokens.map((t) => t.tokenId);
  const balancesQuery = useQuery({
    queryKey: ["admin", "treasury", "balances", [...tokenIds].sort().join(",")],
    queryFn: () => apiClient.treasury.getBalances({ tokenIds }),
    enabled: tokenIds.length > 0,
    retry: false,
  });

  if (tokens.length === 0) return null;

  if (balancesQuery.isLoading) {
    return (
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        loading treasury…
      </div>
    );
  }

  if (balancesQuery.isError) {
    return (
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        treasury unavailable.
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tokens.map((t) => {
        const row = balancesQuery.data?.balances.find((b) => b.tokenId === t.tokenId);
        const balance = row?.balance ?? "0";
        const allocated = row?.totalAllocated ?? "0";
        const free = (BigInt(balance) - BigInt(allocated)).toString();
        const overAllocated = BigInt(allocated) > BigInt(balance);
        return (
          <Card key={t.tokenId} className={overAllocated ? "border-destructive/60" : undefined}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-semibold">{t.symbol}</div>
                <div className="text-xs text-muted-foreground font-mono">{t.tokenId}</div>
              </div>
              <div className="grid gap-1 text-xs text-muted-foreground">
                <div className="flex justify-between gap-3">
                  <span>balance</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {formatTokenAmount(balance, t.tokenId)}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>allocated</span>
                  <span
                    className={`font-mono tabular-nums ${overAllocated ? "text-destructive" : "text-foreground"}`}
                  >
                    {formatTokenAmount(allocated, t.tokenId)}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>free</span>
                  <span
                    className={`font-mono tabular-nums ${overAllocated ? "text-destructive" : "text-foreground"}`}
                  >
                    {formatTokenAmount(free, t.tokenId)}
                  </span>
                </div>
                {overAllocated && (
                  <div className="text-destructive">⚠ allocated exceeds balance</div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
