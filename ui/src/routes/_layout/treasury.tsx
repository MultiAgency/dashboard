import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { z } from "zod";
import {
  Badge,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyTitle,
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
import { BudgetsManager } from "@/components/budgets-manager";
import {
  ALL_STATUS_BUCKETS,
  type OperatorContext,
  type Proposal,
  type ProposalsFilter,
  ProposalsList,
  STATUS_LABEL,
  type StatusBucket,
} from "@/components/proposals-list";
import { TreasuryRollups } from "@/components/treasury-rollups";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { getNetwork } from "@/lib/auth";
import { csvTimestamp, downloadCsv } from "@/lib/csv";
import { formatTokenAmount, tokenSymbol } from "@/lib/format-amount";
import {
  adminContributorsListQueryOptions,
  adminProjectsListQueryOptions,
  publicSettingsQueryOptions,
  tokensListQueryOptions,
  treasuryPublicBalancesQueryOptions,
} from "@/lib/queries";

const TREASURY_TABS = ["balances", "payouts", "overview", "budgets"] as const;
type TreasuryTab = (typeof TREASURY_TABS)[number];

const searchSchema = z.object({
  tab: z.enum(TREASURY_TABS).optional(),
  view: z.enum(["grid", "table"]).optional(),
  status: z.string().optional(),
  token: z.string().optional(),
  q: z.string().optional(),
  // Present in the schema only so `navigate({ search })` preserves it through filter clicks.
  // `getNetwork()` reads URL directly; this field is never consumed here.
  network: z.enum(["mainnet", "testnet"]).optional(),
});

type TreasurySearch = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/_layout/treasury")({
  // Tolerant parsing: unknown/legacy values (e.g. bookmarked `?tab=billings`) fall back to
  // defaults rather than throwing into the router error boundary.
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
  const { isOperator, isLoaded } = useMeRoles();
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

  // Guard against showing a balances-loading skeleton when there are no tokens to fetch:
  // an empty tokenIds list means the loader caught an RPC error and degraded to null.
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
  const visibleTokens = isOperator
    ? tokens
    : tokens.filter((t) => isNonZero(balanceByToken.get(t.tokenId) ?? "0"));

  const proposalsQuery = useInfiniteQuery({
    queryKey: ["proposals", isOperator ? "adminList" : "list", getNetwork()] as const,
    queryFn: ({ pageParam }) =>
      isOperator
        ? apiClient.proposals.adminList({ limit: 50, fromIndex: pageParam })
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
    enabled: isOperator,
  });
  const adminContributorsQuery = useQuery({
    ...adminContributorsListQueryOptions(apiClient),
    enabled: isOperator,
  });
  const operatorContext: OperatorContext | undefined = useMemo(() => {
    if (!isOperator) return undefined;
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
  }, [isOperator, adminProjectsQuery.data, adminContributorsQuery.data]);

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

      {isLoaded && isOperator ? (
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
          <TabsContent value="overview" className="mt-6">
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
