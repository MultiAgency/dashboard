import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Fragment, useCallback, useMemo, useState } from "react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { z } from "zod";
import {
  Badge,
  Budget,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { Field, selectClass } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useMeRoles } from "@/hooks/use-me-roles";
import { type ApiClient, useApiClient } from "@/lib/api";
import { csvTimestamp, downloadCsv } from "@/lib/csv";
import { formatTokenAmount, parseDecimalToBase, tokenSymbol } from "@/lib/format-amount";
import { getNetwork } from "@/lib/network";
import {
  adminContributorsListQueryOptions,
  adminProjectsListQueryOptions,
  adminTokensQueryOptions,
  publicSettingsQueryOptions,
  tokensListQueryOptions,
  treasuryPublicBalancesQueryOptions,
} from "@/lib/queries";
import { trezuProposalUrl } from "@/lib/trezu";

const TREASURY_TABS = ["balances", "payouts", "overview", "budgets"] as const;
type TreasuryTab = (typeof TREASURY_TABS)[number];

const searchSchema = z.object({
  tab: z.enum(TREASURY_TABS).optional(),
  view: z.enum(["grid", "table"]).optional(),
  status: z.string().optional(),
  token: z.string().optional(),
  q: z.string().optional(),
  // Declared so `navigate({ search })` preserves `?network=` across filter clicks.
  network: z.enum(["mainnet", "testnet"]).optional(),
});

type TreasurySearch = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/_layout/treasury")({
  // Tolerant: unknown/legacy ?tab values fall back to defaults rather than throwing.
  validateSearch: (raw: Record<string, unknown>) => searchSchema.safeParse(raw).data ?? {},
  head: () => ({
    meta: [
      { title: "Treasury" },
      { name: "description", content: "On-chain treasury balances of the agency DAO." },
    ],
  }),
  loader: async ({ context }) => {
    const tokens = await context.queryClient
      .ensureQueryData(tokensListQueryOptions(context.apiClient))
      .catch(() => null);

    const tokenIds = tokens?.tokens.map((token) => token.tokenId) ?? [];
    const balances =
      tokenIds.length > 0
        ? await context.queryClient
            .ensureQueryData(treasuryPublicBalancesQueryOptions(context.apiClient, tokenIds))
            .catch(() => null)
        : null;

    return { tokens, balances };
  },
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
  const loaderData = Route.useLoaderData();
  const apiClient = useApiClient();
  const { canAccessAdmin, isLoaded } = useMeRoles();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);

  const activeTab: TreasuryTab = search.tab ?? "balances";
  const balancesView: "grid" | "table" = search.view ?? "grid";
  const proposalsFilter = useMemo(
    () => searchToFilter(search),
    [search.status, search.token, search.q],
  );

  const updateSearch = useCallback(
    (patch: Partial<TreasurySearch>) => {
      navigate({
        search: (prev) => normalizeSearch({ ...(prev as TreasurySearch), ...patch }),
        replace: true,
      });
    },
    [navigate],
  );

  const setActiveTab = (t: TreasuryTab) => updateSearch({ tab: t === "balances" ? undefined : t });
  const setBalancesView = (v: "grid" | "table") =>
    updateSearch({ view: v === "grid" ? undefined : v });
  const setProposalsFilter = (next: ProposalsFilter) => updateSearch(filterToSearch(next));

  const tokensQuery = useQuery({
    ...tokensListQueryOptions(apiClient),
    initialData: loaderData.tokens ?? undefined,
  });

  const tokens = tokensQuery.data?.tokens ?? [];
  const tokenIds = tokens.map((t) => t.tokenId);

  const balancesQuery = useQuery({
    ...treasuryPublicBalancesQueryOptions(apiClient, tokenIds),
    initialData: loaderData.balances ?? undefined,
  });

  // Empty tokenIds = loader caught an RPC error; don't render the balances skeleton then.
  const isLoading = tokensQuery.isLoading || (tokenIds.length > 0 && balancesQuery.isLoading);
  const balanceByToken = new Map(
    (balancesQuery.data?.balances ?? []).map((b) => [b.tokenId, b.balance]),
  );
  const isNonZero = (raw: string) => {
    try {
      return BigInt(raw) > 0n;
    } catch {
      return false;
    }
  };
  const visibleTokens = canAccessAdmin
    ? tokens
    : tokens.filter((t) => isNonZero(balanceByToken.get(t.tokenId) ?? "0"));

  const proposalsQuery = useInfiniteQuery({
    queryKey: ["proposals", canAccessAdmin ? "list" : "list", getNetwork()] as const,
    queryFn: ({ pageParam }) =>
      canAccessAdmin
        ? apiClient.proposals.list({ limit: 50, fromIndex: pageParam })
        : apiClient.proposals.list({ limit: 50, fromIndex: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextFromIndex ?? undefined,
    staleTime: 30_000,
    retry: false,
  });
  const settingsQuery = useQuery(publicSettingsQueryOptions(apiClient));
  const orgAccountId = settingsQuery.data?.orgAccountId ?? null;
  const proposals = useMemo(
    () => proposalsQuery.data?.pages.flatMap((p) => p.data) ?? [],
    [proposalsQuery.data],
  );

  const adminProjectsQuery = useQuery({
    ...adminProjectsListQueryOptions(apiClient),
    enabled: canAccessAdmin,
  });
  const adminContributorsQuery = useQuery({
    ...adminContributorsListQueryOptions(apiClient),
    enabled: canAccessAdmin,
  });
  const operatorContext: OperatorContext | undefined = useMemo(() => {
    if (!canAccessAdmin) return undefined;
    return {
      projects: (adminProjectsQuery.data?.data ?? []).map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
      })),
      contributors: (adminContributorsQuery.data?.data ?? []).map((c) => ({
        id: c.id,
        name: c.name,
      })),
    };
  }, [canAccessAdmin, adminProjectsQuery.data, adminContributorsQuery.data]);

  const proposalsListProps = {
    proposals,
    isLoading: proposalsQuery.isLoading,
    isError: proposalsQuery.isError,
    hasNext: !!proposalsQuery.hasNextPage,
    isFetchingNext: proposalsQuery.isFetchingNextPage,
    fetchNextPage: () => proposalsQuery.fetchNextPage(),
    orgAccountId,
    filter: proposalsFilter,
    onFilterChange: setProposalsFilter,
    operatorContext,
  };

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
          Liquid balances and payouts on the agency's Sputnik DAO contract — live from chain.
        </p>
      </header>

      {isLoaded && canAccessAdmin ? (
        <Tabs value={activeTab} onValueChange={(t) => setActiveTab(t as TreasuryTab)}>
          <TabsList variant="line" className="font-mono text-[11px] uppercase tracking-[0.22em]">
            <TabsTrigger value="balances">balances</TabsTrigger>
            <TabsTrigger value="payouts">payouts</TabsTrigger>
            <TabsTrigger value="overview">overview</TabsTrigger>
            <TabsTrigger value="budgets">budgets</TabsTrigger>
          </TabsList>
          <TabsContent value="balances" className="mt-6">
            <BalancesSection
              isLoading={isLoading}
              tokens={tokens}
              visibleTokens={visibleTokens}
              balanceByToken={balanceByToken}
              onSelectToken={setSelectedToken}
              view={balancesView}
              onViewChange={setBalancesView}
            />
          </TabsContent>
          <TabsContent value="payouts" className="mt-6">
            <ProposalsList {...proposalsListProps} />
          </TabsContent>
          <TabsContent value="overview" className="mt-6 space-y-6">
            <TreasuryRollupsChart />
            <TreasuryRollups />
          </TabsContent>
          <TabsContent value="budgets" className="mt-6 space-y-4">
            <BudgetsManager />
          </TabsContent>
        </Tabs>
      ) : (
        <Tabs
          value={activeTab === "balances" || activeTab === "payouts" ? activeTab : "balances"}
          onValueChange={(t) => setActiveTab(t as TreasuryTab)}
        >
          <TabsList variant="line" className="font-mono text-[11px] uppercase tracking-[0.22em]">
            <TabsTrigger value="balances">balances</TabsTrigger>
            <TabsTrigger value="payouts">payouts</TabsTrigger>
          </TabsList>
          <TabsContent value="balances" className="mt-6">
            <BalancesSection
              isLoading={isLoading}
              tokens={tokens}
              visibleTokens={visibleTokens}
              balanceByToken={balanceByToken}
              onSelectToken={setSelectedToken}
              view={balancesView}
              onViewChange={setBalancesView}
            />
          </TabsContent>
          <TabsContent value="payouts" className="mt-6">
            <ProposalsList {...proposalsListProps} />
          </TabsContent>
        </Tabs>
      )}
      <TokenDetailDialog
        token={selectedToken}
        balance={selectedToken ? (balanceByToken.get(selectedToken.tokenId) ?? "0") : "0"}
        proposals={proposals}
        onOpenChange={(open) => {
          if (!open) setSelectedToken(null);
        }}
      />
    </div>
  );
}

function BalancesSection({
  isLoading,
  tokens,
  visibleTokens,
  balanceByToken,
  onSelectToken,
  view,
  onViewChange,
}: {
  isLoading: boolean;
  tokens: Token[];
  visibleTokens: Token[];
  balanceByToken: Map<string, string>;
  onSelectToken: (t: Token) => void;
  view: "grid" | "table";
  onViewChange: (v: "grid" | "table") => void;
}) {
  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2].map((i) => (
          <TokenCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (tokens.length === 0) {
    return (
      <Empty className="border-2 border-dashed border-border/40">
        <EmptyTitle className="font-display text-2xl uppercase tracking-tight text-muted-foreground">
          no tokens configured
        </EmptyTitle>
      </Empty>
    );
  }
  if (visibleTokens.length === 0) {
    return (
      <Empty className="border-2 border-dashed border-border/40">
        <EmptyTitle className="font-display text-2xl uppercase tracking-tight text-muted-foreground">
          empty treasury
        </EmptyTitle>
      </Empty>
    );
  }
  const exportRows = visibleTokens.map((t) => ({
    token: t,
    balance: balanceByToken.get(t.tokenId) ?? "0",
  }));
  return (
    <div className="space-y-3">
      <BalancesViewToggle
        view={view}
        onViewChange={onViewChange}
        onExport={() => exportBalancesCsv(exportRows)}
        canExport={visibleTokens.length > 0}
      />
      {view === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {visibleTokens.map((token) => (
            <TokenCard
              key={token.tokenId}
              token={token}
              balance={balanceByToken.get(token.tokenId) ?? "0"}
              onSelect={onSelectToken}
            />
          ))}
        </div>
      ) : (
        <BalancesTable
          tokens={visibleTokens}
          balanceByToken={balanceByToken}
          onSelectToken={onSelectToken}
        />
      )}
    </div>
  );
}

function BalancesViewToggle({
  view,
  onViewChange,
  onExport,
  canExport,
}: {
  view: "grid" | "table";
  onViewChange: (v: "grid" | "table") => void;
  onExport: () => void;
  canExport: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mr-1">
        view
      </span>
      {(["grid", "table"] as const).map((v) => {
        const active = view === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onViewChange(v)}
            aria-pressed={active}
            className={`font-mono text-[10px] uppercase tracking-[0.18em] px-2 py-1 border transition-colors duration-150 cursor-pointer ${
              active
                ? "bg-foreground text-background border-foreground"
                : "bg-transparent text-muted-foreground border-foreground/40 hover:text-foreground hover:border-foreground/70"
            }`}
          >
            {v}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onExport}
        disabled={!canExport}
        aria-label="download visible balances as CSV"
        className="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed underline-offset-2 hover:underline"
      >
        export csv ↓
      </button>
    </div>
  );
}

function exportBalancesCsv(rows: { token: Token; balance: string }[]): void {
  downloadCsv(`balances-${csvTimestamp()}.csv`, rows, [
    { header: "symbol", value: (r) => r.token.symbol },
    { header: "network", value: (r) => r.token.network },
    { header: "name", value: (r) => r.token.name },
    { header: "token_id", value: (r) => r.token.tokenId },
    { header: "decimals", value: (r) => r.token.decimals },
    { header: "balance_base_units", value: (r) => r.balance },
    {
      header: "balance_display",
      value: (r) => formatTokenAmount(r.balance, r.token.tokenId),
    },
  ]);
}

function safeBigInt(raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

function BalancesTable({
  tokens,
  balanceByToken,
  onSelectToken,
}: {
  tokens: Token[];
  balanceByToken: Map<string, string>;
  onSelectToken: (t: Token) => void;
}) {
  const sorted = [...tokens].sort((a, b) => {
    if (a.network !== b.network) return a.network.localeCompare(b.network);
    const ba = safeBigInt(balanceByToken.get(a.tokenId) ?? "0");
    const bb = safeBigInt(balanceByToken.get(b.tokenId) ?? "0");
    if (ba === bb) return a.symbol.localeCompare(b.symbol);
    return bb > ba ? 1 : -1;
  });
  return (
    <div className="border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] w-[100px]">
              symbol
            </TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] w-[100px]">
              network
            </TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] text-right">
              balance
            </TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em]">
              contract
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((token) => (
            <TableRow
              key={token.tokenId}
              onClick={() => onSelectToken(token)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectToken(token);
                }
              }}
              tabIndex={0}
              role="button"
              aria-label={`Open ${token.symbol} details`}
              className="cursor-pointer hover:bg-muted/50 focus:bg-muted/50 focus:outline-none"
            >
              <TableCell className="font-mono text-xs uppercase tracking-wide">
                {token.symbol}
              </TableCell>
              <TableCell className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {token.network}
              </TableCell>
              <TableCell className="font-mono tabular-nums text-right whitespace-nowrap">
                {formatTokenAmount(balanceByToken.get(token.tokenId) ?? "0", token.tokenId)}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground break-all max-w-[16rem]">
                {token.tokenId}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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

function TokenCard({
  token,
  balance,
  onSelect,
}: {
  token: Token;
  balance: string;
  onSelect: (t: Token) => void;
}) {
  return (
    <Card
      onClick={() => onSelect(token)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(token);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Open ${token.symbol} details`}
      className="cursor-pointer hover:bg-muted/40 focus:bg-muted/40 focus:outline-none transition-colors duration-150"
    >
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

function TokenDetailDialog({
  token,
  balance,
  proposals,
  onOpenChange,
}: {
  token: Token | null;
  balance: string;
  proposals: Proposal[];
  onOpenChange: (open: boolean) => void;
}) {
  const apiClient = useApiClient();
  const storageQuery = useQuery({
    queryKey: ["tokens", "storage-status", getNetwork(), token?.tokenId ?? ""] as const,
    queryFn: () => apiClient.tokens.getStorageStatus({ tokenId: token?.tokenId ?? "" }),
    enabled: !!token,
    staleTime: 60_000,
    retry: false,
  });
  const tokenTransfers = token
    ? proposals.filter((p) => p.tokenId === token.tokenId).slice(0, 8)
    : [];
  return (
    <Dialog open={!!token} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {token && (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em]">
                <span className="text-muted-foreground">token</span>
                <span>{tokenSymbol(token.tokenId)}</span>
                <Badge variant="outline">{token.network}</Badge>
              </div>
              <DialogTitle className="font-display text-2xl uppercase tracking-tight font-extrabold leading-tight tabular-nums">
                {formatTokenAmount(balance, token.tokenId)}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {token.symbol} token details and recent treasury transfers
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <TokenMetaField label="name" value={token.name} />
              <TokenMetaField label="symbol" value={token.symbol} />
              <TokenMetaField label="decimals" value={String(token.decimals)} />
              <TokenMetaField label="network" value={token.network} />
              <div className="sm:col-span-2">
                <TokenMetaField label="contract" value={token.tokenId} mono />
              </div>
              <div className="sm:col-span-2">
                <StorageStatusField
                  tokenId={token.tokenId}
                  isLoading={storageQuery.isLoading}
                  status={storageQuery.data?.status ?? null}
                />
              </div>
            </dl>
            <div className="space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                recent transfers
              </div>
              {tokenTransfers.length === 0 ? (
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground py-2">
                  no transfers loaded yet
                </p>
              ) : (
                <div className="border border-border">
                  <table className="w-full text-xs">
                    <tbody>
                      {tokenTransfers.map((p) => (
                        <tr key={p.proposalId} className="border-b border-border last:border-b-0">
                          <td className="font-mono text-xs text-muted-foreground px-2 py-2 whitespace-nowrap">
                            #{p.proposalId}
                          </td>
                          <td className="px-2 py-2">
                            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                              {STATUS_LABEL[p.status] ?? p.status}
                            </span>
                          </td>
                          <td className="font-mono tabular-nums text-right px-2 py-2 whitespace-nowrap">
                            {formatTokenAmount(p.amount, p.tokenId)}
                          </td>
                          <td className="font-mono text-xs text-muted-foreground px-2 py-2 break-all max-w-[12rem]">
                            {p.receiverId}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TokenMetaField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className={`${mono ? "font-mono text-xs" : "text-sm"} break-all`}>{value}</div>
    </div>
  );
}

const NATIVE_NEAR_TOKEN_ID = "near";

function StorageStatusField({
  tokenId,
  isLoading,
  status,
}: {
  tokenId: string;
  isLoading: boolean;
  status: { total: string; available: string } | null;
}) {
  const isNative = tokenId === NATIVE_NEAR_TOKEN_ID;
  return (
    <div className="space-y-1">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        nep-145 storage
      </div>
      {isNative ? (
        <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
          n/a — native NEAR
        </p>
      ) : isLoading ? (
        <Skeleton className="h-4 w-32" />
      ) : status ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono text-[10px] uppercase tracking-wide">
            registered
          </Badge>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            total {formatTokenAmount(status.total, "near")} · available{" "}
            {formatTokenAmount(status.available, "near")}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="destructive" className="font-mono text-[10px] uppercase tracking-wide">
            not registered
          </Badge>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            DAO has not registered for this token
          </span>
        </div>
      )}
    </div>
  );
}

function searchToFilter(search: TreasurySearch): ProposalsFilter {
  const buckets = (search.status ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is StatusBucket => (ALL_STATUS_BUCKETS as readonly string[]).includes(s));
  return {
    status: new Set(buckets),
    token: search.token ?? "",
    receiver: search.q ?? "",
  };
}

function filterToSearch(filter: ProposalsFilter): Partial<TreasurySearch> {
  return {
    status: filter.status.size > 0 ? Array.from(filter.status).join(",") : undefined,
    token: filter.token || undefined,
    q: filter.receiver.trim() || undefined,
  };
}

function normalizeSearch(s: TreasurySearch): TreasurySearch {
  const out: TreasurySearch = {};
  if (s.tab && s.tab !== "balances") out.tab = s.tab;
  if (s.view && s.view !== "grid") out.view = s.view;
  if (s.status) out.status = s.status;
  if (s.token) out.token = s.token;
  if (s.q) out.q = s.q;
  if (s.network) out.network = s.network;
  return out;
}

// ── Budget verb (absorbed from budget-verb.tsx) ──

function budgetVerb(amount: string, relatedBudgetId: string | null): string {
  const negative = amount.startsWith("-");
  if (relatedBudgetId) return negative ? "transfer out" : "transfer in";
  return negative ? "deallocate" : "budget";
}

function VerbTag({ verb }: { verb: string }) {
  return (
    <span className="inline-block text-[10px] uppercase tracking-[0.14em] font-mono text-muted-foreground border border-border bg-background px-1.5 py-0.5">
      {verb}
    </span>
  );
}

// ── Token amount fields (absorbed from token-amount-fields.tsx) ──

type KnownToken = {
  tokenId: string;
  network: string;
  symbol: string;
  decimals: number;
  name: string;
  icon: string | null;
};

const CUSTOM_TOKEN = "__custom__";

function TokenAmountFields({
  idPrefix,
  tokens,
  tokenSelection,
  setTokenSelection,
  customTokenId,
  setCustomTokenId,
  amount,
  setAmount,
  amountError,
  disabled,
}: {
  idPrefix: string;
  tokens: KnownToken[];
  tokenSelection: string;
  setTokenSelection: (v: string) => void;
  customTokenId: string;
  setCustomTokenId: (v: string) => void;
  amount: string;
  setAmount: (v: string) => void;
  amountError?: string;
  disabled?: boolean;
}) {
  const isCustom = tokenSelection === CUSTOM_TOKEN;
  const effectiveTokenId = isCustom ? customTokenId.trim() : tokenSelection;
  const knownToken = tokens.find((t) => t.tokenId === effectiveTokenId);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="token" htmlFor={`${idPrefix}-token`}>
          <select
            id={`${idPrefix}-token`}
            value={tokenSelection}
            onChange={(e) => setTokenSelection(e.target.value)}
            disabled={disabled}
            className={selectClass}
          >
            {tokens.map((t) => (
              <option key={t.tokenId} value={t.tokenId}>
                {t.symbol} — {t.name}
              </option>
            ))}
            <option value={CUSTOM_TOKEN}>Custom…</option>
          </select>
          {knownToken?.icon && (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <img src={knownToken.icon} alt="" width={16} height={16} className="rounded-full" />
              <span className="font-mono">{knownToken.tokenId}</span>
            </div>
          )}
        </Field>
        <Field
          label={knownToken ? `amount (${knownToken.symbol})` : "amount (smallest unit)"}
          htmlFor={`${idPrefix}-amount`}
        >
          <Input
            id={`${idPrefix}-amount`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={knownToken ? "1.5" : "1000000000000000000000000"}
            disabled={disabled}
          />
        </Field>
      </div>
      {isCustom && (
        <Field label="custom token id" htmlFor={`${idPrefix}-custom-token`}>
          <Input
            id={`${idPrefix}-custom-token`}
            value={customTokenId}
            onChange={(e) => setCustomTokenId(e.target.value)}
            placeholder="e.g. usdc.token.near"
            disabled={disabled}
          />
        </Field>
      )}
      {isCustom && customTokenId.trim().length > 0 && !knownToken && (
        <p className="text-xs text-muted-foreground">
          ⚠ Decimals unknown for "{effectiveTokenId}". Enter the amount in the token's smallest
          integer unit.
        </p>
      )}
      {amountError && <p className="text-xs text-destructive">{amountError}</p>}
    </>
  );
}

function deriveBaseAmount(
  amount: string,
  knownToken: KnownToken | undefined,
): { value: string; error: string } {
  const trimmed = amount.trim();
  if (trimmed === "") return { value: "", error: "" };
  if (knownToken) {
    try {
      return { value: parseDecimalToBase(trimmed, knownToken.decimals), error: "" };
    } catch (e) {
      return { value: "", error: (e as Error).message };
    }
  }
  return /^\d+$/.test(trimmed)
    ? { value: trimmed, error: "" }
    : { value: "", error: "Amount must be a positive integer (smallest unit)" };
}

// ── BudgetsManager (absorbed from budgets-manager.tsx) ──

function BudgetsManager() {
  const apiClient = useApiClient();
  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));

  const [projectId, setProjectId] = useState<string>("");

  if (projectsQuery.isError) {
    return <AdminError error={projectsQuery.error} />;
  }

  const projects = projectsQuery.data?.data ?? [];
  const selectedProject = projects.find((p) => p.id === projectId);

  return (
    <div className="space-y-6">
      {projects.length > 0 && <AgencyAuditLogPanel projects={projects} />}

      <Card>
        <CardContent className="p-5">
          {projectsQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading projects...</div>
          ) : projects.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No projects yet. Create one on{" "}
              <Link to="/work" className="underline">
                the projects page
              </Link>
              .
            </div>
          ) : (
            <Field label="project" htmlFor="budget-project">
              <select
                id="budget-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className={selectClass}
              >
                <option value="">— pick a project —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} (@{p.slug})
                  </option>
                ))}
              </select>
            </Field>
          )}
        </CardContent>
      </Card>

      {selectedProject && <ProjectBudgetPanel projectId={projectId} />}

      {projects.length >= 2 && <TransferPanel projects={projects} />}
    </div>
  );
}

function AgencyAuditLogPanel({
  projects,
}: {
  projects: Array<{ id: string; slug: string; title: string }>;
}) {
  const apiClient = useApiClient();
  const projectById = new Map(projects.map((p) => [p.id, p] as const));

  const tokensQuery = useQuery(adminTokensQueryOptions(apiClient));
  const tokens = tokensQuery.data?.tokens ?? [];

  const [filterProject, setFilterProject] = useState<string>("");
  const [filterToken, setFilterToken] = useState<string>("");

  const logQuery = useInfiniteQuery({
    queryKey: ["admin", "budgets", "agency", filterProject || null, filterToken || null],
    queryFn: ({ pageParam }) =>
      apiClient.budgets.list({
        projectId: filterProject || undefined,
        tokenId: filterToken || undefined,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const rows = logQuery.data?.pages.flatMap((p) => p.data) ?? [];
  const filtersActive = filterProject !== "" || filterToken !== "";

  return (
    <section className="space-y-3">
      <h2 className="font-display text-2xl uppercase tracking-tight font-extrabold leading-tight">
        Agency audit log
      </h2>
      <p className="text-sm text-muted-foreground max-w-2xl">
        All budget events across projects, newest first. Transfers between projects appear as two
        linked rows.
      </p>
      <Card>
        <CardContent className="p-5 grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="project" htmlFor="audit-filter-project">
            <select
              id="audit-filter-project"
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
          <Field label="token" htmlFor="audit-filter-token">
            <select
              id="audit-filter-token"
              value={filterToken}
              onChange={(e) => setFilterToken(e.target.value)}
              className={selectClass}
            >
              <option value="">all tokens</option>
              {tokens.map((t) => (
                <option key={t.tokenId} value={t.tokenId}>
                  {t.symbol} ({t.tokenId})
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
                setFilterToken("");
              }}
            >
              clear
            </Button>
          </div>
        </CardContent>
      </Card>
      {logQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : rows.length > 0 ? (
        <>
          <div className="space-y-2">
            {rows.map((a) => {
              const project = projectById.get(a.projectId);
              return (
                <div
                  key={a.id}
                  className="rounded-sm border border-border bg-muted/10 p-3 grid gap-1 sm:grid-cols-[140px_1fr] sm:gap-4"
                >
                  <div className="text-xs font-mono text-muted-foreground">
                    {new Date(a.createdAt).toISOString().slice(0, 19).replace("T", " ")}
                  </div>
                  <div className="text-sm break-all space-y-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <VerbTag verb={budgetVerb(a.amount, a.relatedBudgetId)} />
                      <span className="font-mono tabular-nums">
                        {formatTokenAmount(a.amount, a.tokenId)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      project: {project ? `${project.title} (@${project.slug})` : a.projectId}
                    </div>
                    {a.note && <div className="text-xs text-muted-foreground">{a.note}</div>}
                    <div className="text-xs text-muted-foreground font-mono">
                      by {a.actorAccountId}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {logQuery.hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => logQuery.fetchNextPage()}
                disabled={logQuery.isFetchingNextPage}
              >
                {logQuery.isFetchingNextPage ? "loading..." : "load more"}
              </Button>
            </div>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No budget events yet.
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function TransferPanel({
  projects,
}: {
  projects: Array<{ id: string; slug: string; title: string }>;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [fromProjectId, setFromProjectId] = useState<string>(projects[0]?.id ?? "");
  const [toProjectId, setToProjectId] = useState<string>(projects[1]?.id ?? "");
  const [tokenSelection, setTokenSelection] = useState("near");
  const [customTokenId, setCustomTokenId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const tokensQuery = useQuery(adminTokensQueryOptions(apiClient));
  const tokens = tokensQuery.data?.tokens ?? [];

  const isCustom = tokenSelection === CUSTOM_TOKEN;
  const effectiveTokenId = isCustom ? customTokenId.trim() : tokenSelection;
  const knownToken = tokens.find((t) => t.tokenId === effectiveTokenId);
  const { value: amountInBase, error: amountError } = deriveBaseAmount(amount, knownToken);

  const fromBudgetQuery = useQuery({
    queryKey: ["admin", "projects", "budget", fromProjectId],
    queryFn: () => apiClient.agency.projects.getBudget({ projectId: fromProjectId }),
    enabled: fromProjectId !== "",
    staleTime: 30_000,
  });
  const toBudgetQuery = useQuery({
    queryKey: ["admin", "projects", "budget", toProjectId],
    queryFn: () => apiClient.agency.projects.getBudget({ projectId: toProjectId }),
    enabled: toProjectId !== "",
    staleTime: 30_000,
  });

  const fromTokenBudget = fromBudgetQuery.data?.budgets.find((b) => b.tokenId === effectiveTokenId);
  const toTokenBudget = toBudgetQuery.data?.budgets.find((b) => b.tokenId === effectiveTokenId);
  const fromCurrent = fromTokenBudget ? BigInt(fromTokenBudget.budget) : 0n;
  const toCurrent = toTokenBudget ? BigInt(toTokenBudget.budget) : 0n;
  const transferAmount = amountInBase.length > 0 && !amountError ? BigInt(amountInBase) : 0n;
  const fromAfter = fromCurrent - transferAmount;
  const toAfter = toCurrent + transferAmount;
  const showPreview =
    transferAmount > 0n && effectiveTokenId.length > 0 && fromProjectId !== toProjectId;
  const sourceWillGoNegative = showPreview && fromAfter < 0n;

  const transferMutation = useMutation({
    mutationFn: async () =>
      apiClient.budgets.transfer({
        fromProjectId,
        toProjectId,
        tokenId: effectiveTokenId,
        amount: amountInBase,
        note: note.trim() || undefined,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin", "projects", "budget", fromProjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["admin", "projects", "budget", toProjectId],
        }),
        queryClient.invalidateQueries({ queryKey: ["admin", "budgets", fromProjectId] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "budgets", toProjectId] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "budgets", "agency"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "treasury", "balances"] }),
      ]);
      setAmount("");
      setNote("");
      toast.success("Budget transferred");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to transfer"),
  });

  const isPending = transferMutation.isPending;
  const canSubmit =
    fromProjectId !== "" &&
    toProjectId !== "" &&
    fromProjectId !== toProjectId &&
    effectiveTokenId.length > 0 &&
    amountInBase.length > 0 &&
    !amountError &&
    !isPending;

  return (
    <section className="space-y-3">
      <h2 className="font-display text-2xl uppercase tracking-tight font-extrabold leading-tight">
        Transfer between projects
      </h2>
      <Card>
        <CardContent className="p-5 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="from project" htmlFor="transfer-from">
              <select
                id="transfer-from"
                value={fromProjectId}
                onChange={(e) => setFromProjectId(e.target.value)}
                disabled={isPending}
                className={selectClass}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} (@{p.slug})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="to project" htmlFor="transfer-to">
              <select
                id="transfer-to"
                value={toProjectId}
                onChange={(e) => setToProjectId(e.target.value)}
                disabled={isPending}
                className={selectClass}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} (@{p.slug})
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <TokenAmountFields
            idPrefix="transfer"
            tokens={tokens}
            tokenSelection={tokenSelection}
            setTokenSelection={setTokenSelection}
            customTokenId={customTokenId}
            setCustomTokenId={setCustomTokenId}
            amount={amount}
            setAmount={setAmount}
            amountError={amountError}
            disabled={isPending}
          />
          {showPreview && (
            <div className="rounded-sm border border-border bg-muted/10 p-3 grid gap-2 text-xs">
              <div className="text-muted-foreground uppercase tracking-wide">Preview</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-muted-foreground">
                    {projects.find((p) => p.id === fromProjectId)?.title ?? "source"}
                  </div>
                  <div className="space-x-2">
                    <span className="font-mono tabular-nums">
                      {formatTokenAmount(fromCurrent.toString(), effectiveTokenId)}
                    </span>
                    <span>→</span>
                    <span
                      className={`font-mono tabular-nums ${fromAfter < 0n ? "text-destructive" : ""}`}
                    >
                      {formatTokenAmount(fromAfter.toString(), effectiveTokenId)}
                    </span>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-muted-foreground">
                    {projects.find((p) => p.id === toProjectId)?.title ?? "destination"}
                  </div>
                  <div className="space-x-2">
                    <span className="font-mono tabular-nums">
                      {formatTokenAmount(toCurrent.toString(), effectiveTokenId)}
                    </span>
                    <span>→</span>
                    <span className="font-mono tabular-nums">
                      {formatTokenAmount(toAfter.toString(), effectiveTokenId)}
                    </span>
                  </div>
                </div>
              </div>
              {knownToken && (
                <div className="text-muted-foreground font-mono">
                  {amount.trim()} {knownToken.symbol} = {amountInBase}
                </div>
              )}
            </div>
          )}
          <Field label="note (optional)" htmlFor="transfer-note">
            <Input
              id="transfer-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={isPending}
            />
          </Field>
          {sourceWillGoNegative && (
            <p className="text-xs text-destructive">
              ⚠ Source budget will go negative after this transfer. The transfer is allowed and
              flagged in the audit log.
            </p>
          )}
          <div>
            <Button onClick={() => transferMutation.mutate()} disabled={!canSubmit}>
              {isPending ? "transferring..." : "transfer budget"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Moves budget from one project to another atomically. Two linked rows are appended to
            both projects' audit logs (a negative on source, a positive on target). The source
            project's remaining budget is allowed to go negative; over-budget is shown visually, not
            blocked.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

function ProjectBudgetPanel({ projectId }: { projectId: string }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  const budgetQuery = useQuery({
    queryKey: ["admin", "projects", "budget", projectId],
    queryFn: () => apiClient.agency.projects.getBudget({ projectId }),
  });
  const budgetsQuery = useInfiniteQuery({
    queryKey: ["admin", "budgets", projectId],
    queryFn: ({ pageParam }) => apiClient.budgets.list({ projectId, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const budgetRows = budgetsQuery.data?.pages.flatMap((p) => p.data) ?? [];

  const tokensQuery = useQuery(adminTokensQueryOptions(apiClient));
  const tokens = tokensQuery.data?.tokens ?? [];

  const [tokenSelection, setTokenSelection] = useState("near");
  const [customTokenId, setCustomTokenId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const isCustom = tokenSelection === CUSTOM_TOKEN;
  const effectiveTokenId = isCustom ? customTokenId.trim() : tokenSelection;
  const knownToken = tokens.find((t) => t.tokenId === effectiveTokenId);
  const { value: amountInBase, error: amountError } = deriveBaseAmount(amount, knownToken);
  const isValidAmount = amountInBase.length > 0 && !amountError;

  const currentTokenBudget = budgetQuery.data?.budgets.find((b) => b.tokenId === effectiveTokenId);
  const currentBudgetBigInt = currentTokenBudget ? BigInt(currentTokenBudget.budget) : 0n;
  const previewBudgetBigInt = isValidAmount
    ? currentBudgetBigInt + BigInt(amountInBase)
    : currentBudgetBigInt;
  const showPreview = isValidAmount;

  const invalidateAfterMutation = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "budgets", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "projects", "budget", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "budgets", "agency"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "treasury", "balances"] }),
    ]);

  const createMutation = useMutation({
    mutationFn: async () =>
      apiClient.budgets.create({
        projectId,
        tokenId: effectiveTokenId,
        amount: amountInBase,
        note: note.trim() || undefined,
      }),
    onSuccess: async () => {
      await invalidateAfterMutation();
      setAmount("");
      setNote("");
      toast.success("Budget recorded");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to record budget"),
  });

  const deallocateMutation = useMutation({
    mutationFn: async () =>
      apiClient.budgets.deallocate({
        projectId,
        tokenId: effectiveTokenId,
        amount: amountInBase,
        note: note.trim() || undefined,
      }),
    onSuccess: async () => {
      await invalidateAfterMutation();
      setAmount("");
      setNote("");
      toast.success("Deallocation recorded");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to record deallocation"),
  });

  const isPending = createMutation.isPending || deallocateMutation.isPending;
  const canSubmit = effectiveTokenId.length > 0 && isValidAmount && !isPending;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="font-display text-2xl uppercase tracking-tight font-extrabold leading-tight">
          Budget
        </h2>
        {budgetQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading budget...</div>
        ) : budgetQuery.data && budgetQuery.data.budgets.length > 0 ? (
          <div className="space-y-4">
            {budgetQuery.data.budgets.map((b) => (
              <Budget key={b.tokenId} budget={b} />
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No budget yet.</div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl uppercase tracking-tight font-extrabold leading-tight">
          New budget
        </h2>
        <Card>
          <CardContent className="p-5 grid gap-4">
            <TokenAmountFields
              idPrefix="budget"
              tokens={tokens}
              tokenSelection={tokenSelection}
              setTokenSelection={setTokenSelection}
              customTokenId={customTokenId}
              setCustomTokenId={setCustomTokenId}
              amount={amount}
              setAmount={setAmount}
              amountError={amountError}
              disabled={isPending}
            />
            {showPreview && (
              <div className="text-xs text-muted-foreground space-x-2">
                <span>{effectiveTokenId} budget:</span>
                <span className="font-mono tabular-nums">
                  {formatTokenAmount(currentBudgetBigInt.toString(), effectiveTokenId)}
                </span>
                <span>→</span>
                <span className={`font-mono ${previewBudgetBigInt < 0n ? "text-destructive" : ""}`}>
                  {formatTokenAmount(previewBudgetBigInt.toString(), effectiveTokenId)}
                </span>
                {knownToken && (
                  <span className="font-mono tabular-nums">
                    ({amount.trim()} {knownToken.symbol} = {amountInBase})
                  </span>
                )}
              </div>
            )}
            <Field label="note (optional)" htmlFor="budget-note">
              <Input
                id="budget-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={isPending}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => createMutation.mutate()} disabled={!canSubmit}>
                {createMutation.isPending ? "recording..." : "record budget"}
              </Button>
              <Button
                variant="outline"
                onClick={() => deallocateMutation.mutate()}
                disabled={!canSubmit}
              >
                {deallocateMutation.isPending ? "recording..." : "record deallocation"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Recorded to the audit log; nothing is executed on-chain. Project budgets are allowed
              to go negative — over-budget is shown visually, not blocked.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl uppercase tracking-tight font-extrabold leading-tight">
          Audit log
        </h2>
        {budgetsQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading budget events...</div>
        ) : budgetRows.length > 0 ? (
          <>
            <div className="space-y-2">
              {budgetRows.map((a) => (
                <div
                  key={a.id}
                  className="rounded-sm border border-border bg-muted/10 p-3 grid gap-1 sm:grid-cols-[140px_1fr] sm:gap-4"
                >
                  <div className="text-xs font-mono text-muted-foreground">
                    {new Date(a.createdAt).toISOString().slice(0, 19).replace("T", " ")}
                  </div>
                  <div className="text-sm break-all space-y-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <VerbTag verb={budgetVerb(a.amount, a.relatedBudgetId)} />
                      <span className="font-mono tabular-nums">
                        {formatTokenAmount(a.amount, a.tokenId)}
                      </span>
                    </div>
                    {a.note && <div className="text-xs text-muted-foreground">{a.note}</div>}
                    <div className="text-xs text-muted-foreground font-mono">
                      by {a.actorAccountId}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {budgetsQuery.hasNextPage && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => budgetsQuery.fetchNextPage()}
                  disabled={budgetsQuery.isFetchingNextPage}
                >
                  {budgetsQuery.isFetchingNextPage ? "loading..." : "load more"}
                </Button>
              </div>
            )}
          </>
        ) : (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No budget events recorded yet.
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

// ── ProposalsList (absorbed from proposals-list.tsx) ──

type ProposalStatus =
  | "InProgress"
  | "Approved"
  | "Rejected"
  | "Removed"
  | "Expired"
  | "Moved"
  | "Failed";

type StatusBucket = "open" | "approved" | "failed" | "closed";

const ALL_STATUS_BUCKETS: StatusBucket[] = ["open", "approved", "failed", "closed"];

const STATUS_TO_BUCKET: Record<ProposalStatus, StatusBucket> = {
  InProgress: "open",
  Approved: "approved",
  Failed: "failed",
  Rejected: "closed",
  Removed: "closed",
  Expired: "closed",
  Moved: "closed",
};

const STATUS_BUCKETS: { key: StatusBucket; label: string }[] = [
  { key: "open", label: "open" },
  { key: "approved", label: "approved" },
  { key: "failed", label: "failed" },
  { key: "closed", label: "closed" },
];

type ProposalsFilter = {
  status: ReadonlySet<StatusBucket>;
  token: string;
  receiver: string;
};

const EMPTY_PROPOSALS_FILTER: ProposalsFilter = {
  status: new Set(),
  token: "",
  receiver: "",
};

const ALL_TOKENS_SENTINEL = "__all__";
const NO_CONTRIBUTOR_SENTINEL = "__none__";

type ProposalMapping = {
  billingId: string;
  projectId: string;
  projectSlug: string;
  projectTitle: string;
};

type VoteAction = "Approve" | "Reject" | "Remove";

type Proposal = {
  proposalId: string;
  proposer: string;
  description: string;
  status: ProposalStatus;
  tokenId: string;
  receiverId: string;
  amount: string;
  submissionTime: string;
  votes: Record<string, VoteAction>;
  mapping?: ProposalMapping | null;
};

type OperatorContext = {
  projects: Array<{ id: string; slug: string; title: string }>;
  contributors: Array<{ id: string; name: string }>;
};

const BILLING_INVALIDATIONS = [
  ["proposals", "list"],
  ["admin", "billings", "list"],
  ["admin", "projects", "budget"],
  ["treasury", "rollups"],
] as const;

type ProposalsListProps = {
  proposals: Proposal[];
  isLoading: boolean;
  isError: boolean;
  hasNext: boolean;
  isFetchingNext: boolean;
  fetchNextPage: () => void;
  orgAccountId: string | null;
  filter: ProposalsFilter;
  onFilterChange: (next: ProposalsFilter) => void;
  operatorContext?: OperatorContext;
};

function ProposalsList({
  proposals,
  isLoading,
  isError,
  hasNext,
  isFetchingNext,
  fetchNextPage,
  orgAccountId,
  filter,
  onFilterChange,
  operatorContext,
}: ProposalsListProps) {
  const [selected, setSelected] = useState<Proposal | null>(null);

  const distinctTokens = useMemo(() => {
    const set = new Set<string>();
    for (const p of proposals) if (p.tokenId) set.add(p.tokenId);
    return Array.from(set).sort();
  }, [proposals]);

  const filtered = useMemo(() => {
    const q = filter.receiver.trim().toLowerCase();
    return proposals.filter((p) => {
      if (filter.status.size > 0 && !filter.status.has(STATUS_TO_BUCKET[p.status])) return false;
      if (filter.token && p.tokenId !== filter.token) return false;
      if (q && !p.receiverId.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [proposals, filter]);

  const toggleBucket = (bucket: StatusBucket) => {
    const next = new Set(filter.status);
    if (next.has(bucket)) next.delete(bucket);
    else next.add(bucket);
    onFilterChange({ ...filter, status: next });
  };

  const hasActiveFilter = filter.status.size > 0 || !!filter.token || filter.receiver.trim() !== "";
  const clearFilters = () => onFilterChange(EMPTY_PROPOSALS_FILTER);

  if (isLoading) {
    return (
      <div className="border border-border">
        <Table>
          <ProposalsTableHeader />
          <TableBody>
            {[0, 1, 2].map((i) => (
              <ProposalRowSkeleton key={i} />
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }
  if (isError) {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        could not load — try again
      </p>
    );
  }
  if (proposals.length === 0) {
    return (
      <Empty className="border-2 border-dashed border-border/40">
        <EmptyTitle className="font-display text-2xl uppercase tracking-tight text-muted-foreground">
          no payouts yet
        </EmptyTitle>
      </Empty>
    );
  }
  return (
    <div className="space-y-4">
      <ProposalsFilterBar
        statusFilter={filter.status}
        onToggleBucket={toggleBucket}
        tokenFilter={filter.token}
        onTokenChange={(t) => onFilterChange({ ...filter, token: t })}
        distinctTokens={distinctTokens}
        receiverQuery={filter.receiver}
        onReceiverChange={(q) => onFilterChange({ ...filter, receiver: q })}
        total={proposals.length}
        shown={filtered.length}
        hasActiveFilter={hasActiveFilter}
        onClear={clearFilters}
        onExport={() => exportProposalsCsv(filtered)}
        canExport={filtered.length > 0}
      />
      <div className="border border-border">
        <Table>
          <ProposalsTableHeader />
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground text-center py-8"
                >
                  no matches — clear filters to see all
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p) => (
                <ProposalRow
                  key={p.proposalId}
                  proposal={p}
                  onSelect={setSelected}
                  showAttribution={!!operatorContext}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {hasNext && (
        <div className="flex justify-center pt-2">
          <Button
            onClick={fetchNextPage}
            disabled={isFetchingNext}
            variant="outline"
            className="font-display uppercase tracking-wide"
          >
            {isFetchingNext ? "loading..." : "load more →"}
          </Button>
        </div>
      )}
      <ProposalDetailDialog
        proposal={selected}
        orgAccountId={orgAccountId}
        operatorContext={operatorContext}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}

function ProposalsFilterBar({
  statusFilter,
  onToggleBucket,
  tokenFilter,
  onTokenChange,
  distinctTokens,
  receiverQuery,
  onReceiverChange,
  total,
  shown,
  hasActiveFilter,
  onClear,
  onExport,
  canExport,
}: {
  statusFilter: ReadonlySet<StatusBucket>;
  onToggleBucket: (b: StatusBucket) => void;
  tokenFilter: string;
  onTokenChange: (t: string) => void;
  distinctTokens: string[];
  receiverQuery: string;
  onReceiverChange: (q: string) => void;
  total: number;
  shown: number;
  hasActiveFilter: boolean;
  onClear: () => void;
  onExport: () => void;
  canExport: boolean;
}) {
  return (
    <div className="space-y-3 border border-border bg-card/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mr-1">
          status
        </span>
        {STATUS_BUCKETS.map((b) => {
          const active = statusFilter.has(b.key);
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => onToggleBucket(b.key)}
              aria-pressed={active}
              className={`font-mono text-[10px] uppercase tracking-[0.18em] px-2 py-1 border transition-colors duration-150 cursor-pointer ${
                active
                  ? "bg-foreground text-background border-foreground"
                  : "bg-transparent text-muted-foreground border-foreground/40 hover:text-foreground hover:border-foreground/70"
              }`}
            >
              {b.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            token
          </div>
          <Select
            value={tokenFilter || ALL_TOKENS_SENTINEL}
            onValueChange={(v) => onTokenChange(v === ALL_TOKENS_SENTINEL ? "" : v)}
          >
            <SelectTrigger
              aria-label="filter by token"
              className="font-mono text-xs uppercase tracking-wide h-8"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TOKENS_SENTINEL}>all tokens</SelectItem>
              {distinctTokens.map((tid) => (
                <SelectItem key={tid} value={tid}>
                  {tokenSymbol(tid)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 flex-1 min-w-[12rem]">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            receiver
          </div>
          <Input
            value={receiverQuery}
            onChange={(e) => onReceiverChange(e.target.value)}
            placeholder="search account…"
            aria-label="filter by receiver account"
            className="font-mono text-xs h-8"
          />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground tabular-nums">
            {shown === total ? `${total}` : `${shown} of ${total}`}
          </div>
          {hasActiveFilter && (
            <button
              type="button"
              onClick={onClear}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground cursor-pointer underline-offset-2 hover:underline"
            >
              clear ✕
            </button>
          )}
          <button
            type="button"
            onClick={onExport}
            disabled={!canExport}
            aria-label="download visible rows as CSV"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed underline-offset-2 hover:underline"
          >
            export csv ↓
          </button>
        </div>
      </div>
    </div>
  );
}

function ProposalsTableHeader() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] w-[80px]">
          id
        </TableHead>
        <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] w-[110px]">
          status
        </TableHead>
        <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em]">
          description
        </TableHead>
        <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] text-right">
          amount
        </TableHead>
        <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em]">to</TableHead>
        <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] w-[120px]">
          submitted
        </TableHead>
      </TableRow>
    </TableHeader>
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

type BadgeVariantLocal = "default" | "secondary" | "accent" | "destructive" | "outline";
const STATUS_VARIANT: Record<ProposalStatus, BadgeVariantLocal> = {
  InProgress: "default",
  Approved: "secondary",
  Rejected: "outline",
  Removed: "outline",
  Expired: "outline",
  Moved: "outline",
  Failed: "destructive",
};

function ProposalRowSkeleton() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="h-3 w-12" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-16" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3 w-full" />
      </TableCell>
      <TableCell className="text-right">
        <Skeleton className="h-3 w-16 ml-auto" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3 w-24" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3 w-20" />
      </TableCell>
    </TableRow>
  );
}

const STATUS_ROW_TINT: Record<ProposalStatus, string> = {
  InProgress: "",
  Approved: "",
  Failed: "bg-destructive/5",
  Rejected: "bg-muted/40",
  Removed: "bg-muted/40",
  Expired: "bg-muted/40",
  Moved: "bg-muted/40",
};

function ProposalRow({
  proposal,
  onSelect,
  showAttribution,
}: {
  proposal: Proposal;
  onSelect: (p: Proposal) => void;
  showAttribution: boolean;
}) {
  const submitted = formatSubmitted(proposal.submissionTime, "date");
  const tint = STATUS_ROW_TINT[proposal.status] ?? "";
  return (
    <TableRow
      onClick={() => onSelect(proposal)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(proposal);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Open proposal ${proposal.proposalId} details`}
      className={`cursor-pointer hover:bg-muted/50 focus:bg-muted/50 focus:outline-none ${tint}`}
    >
      <TableCell className="font-mono text-xs text-muted-foreground">
        #{proposal.proposalId}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={STATUS_VARIANT[proposal.status] ?? "outline"}>
            {STATUS_LABEL[proposal.status] ?? proposal.status}
          </Badge>
          {showAttribution && proposal.mapping && (
            <Badge variant="outline" className="font-mono text-[10px]">
              @{proposal.mapping.projectSlug}
            </Badge>
          )}
          {showAttribution && !proposal.mapping && proposal.status === "Approved" && (
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              unrecorded
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-sm max-w-[24rem]">
        <span className="line-clamp-2 break-words">{proposal.description}</span>
      </TableCell>
      <TableCell className="font-mono tabular-nums text-right whitespace-nowrap">
        {formatTokenAmount(proposal.amount, proposal.tokenId)}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground break-all max-w-[14rem]">
        {proposal.receiverId}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
        {submitted}
      </TableCell>
    </TableRow>
  );
}

function ProposalDetailDialog({
  proposal,
  orgAccountId,
  operatorContext,
  onOpenChange,
}: {
  proposal: Proposal | null;
  orgAccountId: string | null;
  operatorContext?: OperatorContext;
  onOpenChange: (open: boolean) => void;
}) {
  const trezuUrl =
    proposal && orgAccountId ? trezuProposalUrl(orgAccountId, proposal.proposalId) : null;
  return (
    <Dialog open={!!proposal} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {proposal && (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em]">
                <span className="text-muted-foreground">proposal</span>
                <span>#{proposal.proposalId}</span>
                <Badge variant={STATUS_VARIANT[proposal.status] ?? "outline"}>
                  {STATUS_LABEL[proposal.status] ?? proposal.status}
                </Badge>
              </div>
              <DialogTitle className="font-display text-2xl uppercase tracking-tight font-extrabold leading-tight">
                {formatTokenAmount(proposal.amount, proposal.tokenId)}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Transfer proposal #{proposal.proposalId} details
              </DialogDescription>
            </DialogHeader>
            <dl className="grid gap-3 text-sm">
              <DetailField label="receiver" value={proposal.receiverId} mono />
              <DetailField label="proposer" value={proposal.proposer} mono />
              <DetailField
                label="submitted"
                value={formatSubmitted(proposal.submissionTime, "minute")}
                mono
              />
              <VoteTally votes={proposal.votes} />
              {proposal.description && (
                <div className="space-y-1">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    description
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {proposal.description}
                  </p>
                </div>
              )}
            </dl>
            {operatorContext && (
              <ProposalBillingSection
                proposal={proposal}
                operatorContext={operatorContext}
                onAfterChange={() => onOpenChange(false)}
              />
            )}
            <DialogFooter>
              {trezuUrl && (
                <Button asChild variant="outline" className="font-display uppercase tracking-wide">
                  <a href={trezuUrl} target="_blank" rel="noopener noreferrer">
                    view on trezu <ArrowUpRight className="ml-1 size-3" />
                  </a>
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProposalBillingSection({
  proposal,
  operatorContext,
  onAfterChange,
}: {
  proposal: Proposal;
  operatorContext: OperatorContext;
  onAfterChange: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { projects, contributors } = operatorContext;
  const [projectId, setProjectId] = useState("");
  const [contributorId, setContributorId] = useState("");
  const [note, setNote] = useState("");

  const invalidate = () =>
    Promise.all(
      BILLING_INVALIDATIONS.map((key) => queryClient.invalidateQueries({ queryKey: [...key] })),
    );

  const recordMutation = useMutation({
    mutationFn: async () =>
      apiClient.billings.create({
        projectId,
        contributorId: contributorId || undefined,
        proposalId: proposal.proposalId,
        note: note.trim() || undefined,
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success(`Proposal #${proposal.proposalId} recorded`);
      onAfterChange();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to record billing"),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!proposal.mapping) throw new Error("No billing to delete");
      return apiClient.billings.delete({ id: proposal.mapping.billingId });
    },
    onSuccess: async () => {
      await invalidate();
      toast.success(`Billing for proposal #${proposal.proposalId} deleted`);
      onAfterChange();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete billing"),
  });

  const [confirmOpen, setConfirmOpen] = useState(false);

  if (proposal.mapping) {
    return (
      <>
        <div className="space-y-2 border-t pt-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            billing
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/admin/projects/$slug"
              params={{ slug: proposal.mapping.projectSlug }}
              className="font-mono text-xs underline-offset-2 hover:underline"
            >
              @{proposal.mapping.projectSlug}
            </Link>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-xs"
              onClick={() => setConfirmOpen(true)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "deleting..." : "delete"}
            </Button>
          </div>
        </div>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={`Delete billing for proposal #${proposal.proposalId}?`}
          description="You can re-record it afterwards. Chain status remains the source of truth."
          confirmLabel="delete"
          destructive
          onConfirm={async () => {
            await deleteMutation.mutateAsync();
          }}
        />
      </>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="space-y-1 border-t pt-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          billing
        </div>
        <p className="text-xs text-muted-foreground">Create a project before recording billings.</p>
      </div>
    );
  }

  const canRecord = projectId !== "" && !recordMutation.isPending;
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        record billing
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="project" htmlFor={`record-project-${proposal.proposalId}`}>
          <Select
            value={projectId}
            onValueChange={setProjectId}
            disabled={recordMutation.isPending}
          >
            <SelectTrigger id={`record-project-${proposal.proposalId}`} className="w-full">
              <SelectValue placeholder="select project…" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="contributor" htmlFor={`record-contributor-${proposal.proposalId}`}>
          <Select
            value={contributorId || NO_CONTRIBUTOR_SENTINEL}
            onValueChange={(v) => setContributorId(v === NO_CONTRIBUTOR_SENTINEL ? "" : v)}
            disabled={recordMutation.isPending}
          >
            <SelectTrigger id={`record-contributor-${proposal.proposalId}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CONTRIBUTOR_SENTINEL}>none</SelectItem>
              {contributors.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="note" htmlFor={`record-note-${proposal.proposalId}`}>
        <Input
          id={`record-note-${proposal.proposalId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={recordMutation.isPending}
          maxLength={2000}
        />
      </Field>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => recordMutation.mutate()} disabled={!canRecord}>
          {recordMutation.isPending ? "recording..." : "record"}
        </Button>
      </div>
    </div>
  );
}

function VoteTally({ votes }: { votes: Record<string, VoteAction> }) {
  const entries = Object.values(votes);
  const counts = { Approve: 0, Reject: 0, Remove: 0 };
  for (const v of entries) counts[v]++;
  return (
    <div className="space-y-1">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        votes
      </div>
      {entries.length === 0 ? (
        <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
          no tally available
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums">
          <span>
            <span className="text-muted-foreground">approve</span> {counts.Approve}
          </span>
          <span>
            <span className="text-muted-foreground">reject</span> {counts.Reject}
          </span>
          {counts.Remove > 0 && (
            <span>
              <span className="text-muted-foreground">remove</span> {counts.Remove}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className={`${mono ? "font-mono text-xs" : "text-sm"} break-all`}>{value}</div>
    </div>
  );
}

function formatSubmitted(submissionTime: string, precision: "date" | "minute" | "iso"): string {
  try {
    const iso = new Date(Number(BigInt(submissionTime) / 1_000_000n)).toISOString();
    if (precision === "date") return iso.slice(0, 10);
    if (precision === "minute") return `${iso.slice(0, 16).replace("T", " ")} UTC`;
    return iso;
  } catch {
    return "—";
  }
}

function exportProposalsCsv(rows: Proposal[]): void {
  downloadCsv(`payouts-${csvTimestamp()}.csv`, rows, [
    { header: "proposal_id", value: (r) => r.proposalId },
    { header: "status", value: (r) => r.status },
    { header: "submitted_utc", value: (r) => formatSubmitted(r.submissionTime, "iso") },
    { header: "token_symbol", value: (r) => tokenSymbol(r.tokenId) },
    { header: "token_id", value: (r) => r.tokenId },
    { header: "amount_base_units", value: (r) => r.amount },
    { header: "amount_display", value: (r) => formatTokenAmount(r.amount, r.tokenId) },
    { header: "receiver", value: (r) => r.receiverId },
    { header: "proposer", value: (r) => r.proposer },
    { header: "description", value: (r) => r.description },
  ]);
}

// ── TreasuryRollups (absorbed from treasury-rollups.tsx) ──

type Rollup = Awaited<ReturnType<ApiClient["treasury"]["getRollups"]>>["rollups"][number];

const STAGE_DEFS = [
  { key: "remaining", color: "var(--muted-foreground)" },
  { key: "allocated", color: "var(--chart-3)" },
  { key: "committed", color: "var(--chart-1)" },
  { key: "paid", color: "var(--chart-4)" },
] as const;

type StageKey = (typeof STAGE_DEFS)[number]["key"];

const chartConfig = Object.fromEntries(
  STAGE_DEFS.map((s) => [s.key, { label: s.key, color: s.color }]),
) satisfies ChartConfig;

type ChartRow = {
  tokenId: string;
  remaining: number;
  allocated: number;
  committed: number;
  paid: number;
  remainingRaw: string;
  allocatedRaw: string;
  committedRaw: string;
  paidRaw: string;
  budgetedRaw: string;
};

function rollupHasActivity(r: Rollup): boolean {
  return (
    BigInt(r.paid) !== 0n ||
    BigInt(r.committed) !== 0n ||
    BigInt(r.allocated) !== 0n ||
    BigInt(r.remaining) !== 0n
  );
}

function rollupToChartRow(r: Rollup): ChartRow {
  const remaining = BigInt(r.remaining);
  const allocated = BigInt(r.allocated);
  const committed = BigInt(r.committed);
  const paid = BigInt(r.paid);
  const budgeted = BigInt(r.budgeted);

  const posRemaining = remaining > 0n ? remaining : 0n;
  const denom = budgeted > 0n ? budgeted : posRemaining + allocated + committed + paid;
  const toPct = (v: bigint) => (denom === 0n ? 0 : Number((v * 10000n) / denom) / 100);

  return {
    tokenId: r.tokenId,
    remaining: toPct(posRemaining),
    allocated: toPct(allocated),
    committed: toPct(committed),
    paid: toPct(paid),
    remainingRaw: r.remaining,
    allocatedRaw: r.allocated,
    committedRaw: r.committed,
    paidRaw: r.paid,
    budgetedRaw: r.budgeted,
  };
}

function TreasuryRollupsChart() {
  const apiClient = useApiClient();
  const rollupsQuery = useQuery({
    queryKey: ["treasury", "rollups"],
    queryFn: () => apiClient.treasury.getRollups(),
    staleTime: 30_000,
    retry: false,
  });

  if (rollupsQuery.isLoading) {
    return (
      <div className="border border-border p-4 space-y-4">
        <ChartLegend />
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <ChartRowSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }
  if (rollupsQuery.isError) {
    return null;
  }

  const rows = (rollupsQuery.data?.rollups ?? []).filter(rollupHasActivity).map(rollupToChartRow);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="border border-border p-4 space-y-4">
      <ChartLegend />
      <div className="grid grid-cols-[minmax(80px,160px)_1fr_minmax(80px,auto)] items-center gap-x-3 gap-y-2">
        {rows.map((row) => (
          <Fragment key={row.tokenId}>
            <div className="font-mono text-[11px] truncate text-foreground" title={row.tokenId}>
              {row.tokenId}
            </div>
            <ChartContainer config={chartConfig} className="h-6 w-full">
              <BarChart
                data={[row]}
                layout="vertical"
                margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
              >
                <XAxis type="number" domain={[0, 100]} hide />
                <YAxis type="category" dataKey="tokenId" hide />
                <ChartTooltip
                  cursor={{ fill: "var(--muted)", fillOpacity: 0.3 }}
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(value, name, item) => {
                        const r = (item?.payload ?? {}) as ChartRow;
                        const key = String(name) as StageKey;
                        const raw = r[`${key}Raw` as keyof ChartRow] as string | undefined;
                        const pct = Number(value);
                        if (raw === undefined || pct === 0) return null;
                        return (
                          <div className="flex w-full items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <span
                                className="inline-block h-2.5 w-2.5 border border-border"
                                style={{ backgroundColor: `var(--color-${key})` }}
                              />
                              <span className="font-mono text-[11px] uppercase tracking-[0.18em]">
                                {key}
                              </span>
                            </div>
                            <span className="font-mono text-[11px] tabular-nums">
                              {formatTokenAmount(raw, r.tokenId)} ({pct.toFixed(1)}%)
                            </span>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Bar dataKey="remaining" stackId="x" fill="var(--color-remaining)" />
                <Bar dataKey="allocated" stackId="x" fill="var(--color-allocated)" />
                <Bar dataKey="committed" stackId="x" fill="var(--color-committed)" />
                <Bar dataKey="paid" stackId="x" fill="var(--color-paid)" />
              </BarChart>
            </ChartContainer>
            <div className="font-mono text-[11px] tabular-nums text-right whitespace-nowrap text-foreground">
              {formatTokenAmount(row.budgetedRaw, row.tokenId)}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function ChartLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      {STAGE_DEFS.map((stage, i) => (
        <div key={stage.key} className="flex items-center gap-1.5">
          {i > 0 && (
            <span className="text-muted-foreground/60" aria-hidden>
              →
            </span>
          )}
          <span
            className="inline-block h-3 w-3 border border-border"
            style={{ backgroundColor: stage.color }}
          />
          <span>{stage.key}</span>
        </div>
      ))}
      <span className="ml-auto text-muted-foreground/70">flow</span>
    </div>
  );
}

function ChartRowSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-4 flex-1" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

function TreasuryRollups() {
  const apiClient = useApiClient();
  const rollupsQuery = useQuery({
    queryKey: ["treasury", "rollups"],
    queryFn: () => apiClient.treasury.getRollups(),
    staleTime: 30_000,
    retry: false,
  });

  if (rollupsQuery.isLoading) {
    return (
      <div className="border border-border">
        <Table>
          <RollupsTableHeader />
          <TableBody>
            {[0, 1].map((i) => (
              <RollupRowSkeleton key={i} />
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }
  if (rollupsQuery.isError) {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        could not load — try again
      </p>
    );
  }
  const rollups = rollupsQuery.data?.rollups ?? [];
  if (rollups.length === 0) {
    return (
      <Empty className="border-2 border-dashed border-border/40">
        <EmptyTitle className="font-mono text-sm font-normal text-muted-foreground">
          No activity yet. Budget funds, attach NEARN listings, or record billings to see the
          rollup.
        </EmptyTitle>
      </Empty>
    );
  }
  return (
    <div className="border border-border">
      <Table>
        <RollupsTableHeader />
        <TableBody>
          {rollups.map((r) => (
            <RollupRow key={r.tokenId} rollup={r} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RollupsTableHeader() {
  const cols = ["balance", "budgeted", "allocated", "committed", "paid", "remaining", "available"];
  return (
    <TableHeader>
      <TableRow>
        <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em]">token</TableHead>
        {cols.map((c) => (
          <TableHead
            key={c}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-right"
          >
            {c}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

function RollupRow({ rollup }: { rollup: Rollup }) {
  const isNeg = (s: string) => s.trim().startsWith("-");
  return (
    <TableRow>
      <TableCell className="font-mono text-xs break-all">{rollup.tokenId}</TableCell>
      <TableCell className="font-mono tabular-nums text-right whitespace-nowrap">
        {formatTokenAmount(rollup.balance, rollup.tokenId)}
      </TableCell>
      <TableCell className="font-mono tabular-nums text-right whitespace-nowrap">
        {formatTokenAmount(rollup.budgeted, rollup.tokenId)}
      </TableCell>
      <TableCell className="font-mono tabular-nums text-right whitespace-nowrap">
        {formatTokenAmount(rollup.allocated, rollup.tokenId)}
      </TableCell>
      <TableCell className="font-mono tabular-nums text-right whitespace-nowrap">
        {formatTokenAmount(rollup.committed, rollup.tokenId)}
      </TableCell>
      <TableCell className="font-mono tabular-nums text-right whitespace-nowrap">
        {formatTokenAmount(rollup.paid, rollup.tokenId)}
      </TableCell>
      <TableCell
        className={`font-mono tabular-nums text-right whitespace-nowrap ${
          isNeg(rollup.remaining) ? "text-destructive" : ""
        }`}
      >
        {formatTokenAmount(rollup.remaining, rollup.tokenId)}
      </TableCell>
      <TableCell
        className={`font-mono tabular-nums text-right whitespace-nowrap ${
          isNeg(rollup.available) ? "text-destructive" : ""
        }`}
      >
        {formatTokenAmount(rollup.available, rollup.tokenId)}
      </TableCell>
    </TableRow>
  );
}

function RollupRowSkeleton() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="h-3 w-20" />
      </TableCell>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <TableCell key={i} className="text-right">
          <Skeleton className="h-3 w-20 ml-auto" />
        </TableCell>
      ))}
    </TableRow>
  );
}
