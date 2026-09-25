import {
  ArrowUpRightIcon,
  CoinsIcon,
  DownloadSimpleIcon,
  MagnifyingGlassIcon,
  ReceiptIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type KeyboardEvent, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
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
  ToggleGroup,
  ToggleGroupItem,
} from "@/components";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { csvTimestamp, downloadCsv } from "@/lib/csv";
import { formatTokenAmount, tokenSymbol } from "@/lib/format-amount";
import {
  adminContributorsListQueryOptions,
  adminProjectsListQueryOptions,
  proposalsQueryKey,
  publicSettingsQueryOptions,
  refreshAfter,
  tokenStorageStatusQueryOptions,
  tokensListQueryOptions,
  treasuryPublicBalancesQueryOptions,
} from "@/lib/queries";
import { isDefaultOrganizationStaff } from "@/lib/treasury";
import { trezuProposalUrl } from "@/lib/trezu";

const TREASURY_TABS = ["balances", "payouts"] as const;
type TreasuryTab = (typeof TREASURY_TABS)[number];

const searchSchema = z.object({
  tab: z.enum(TREASURY_TABS).optional(),
  view: z.enum(["grid", "table"]).optional(),
  status: z.string().optional(),
  token: z.string().optional(),
  q: z.string().optional(),
});

type TreasurySearch = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/_layout/treasury")({
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
  const { canAccessAdmin, agencyDao } = useMeRoles();
  const settingsQuery = useQuery(publicSettingsQueryOptions(apiClient));
  const orgAccountId = settingsQuery.data?.orgAccountId ?? null;
  const isDefaultStaff = isDefaultOrganizationStaff(canAccessAdmin, agencyDao, orgAccountId);
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
  const visibleTokens = isDefaultStaff
    ? tokens
    : tokens.filter((t) => isNonZero(balanceByToken.get(t.tokenId) ?? "0"));

  const proposalsQuery = useInfiniteQuery({
    queryKey: proposalsQueryKey(),
    queryFn: ({ pageParam }) => apiClient.proposals.list({ limit: 50, fromIndex: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextFromIndex ?? undefined,
    staleTime: 30_000,
    retry: false,
  });
  const proposals = useMemo(
    () => proposalsQuery.data?.pages.flatMap((p) => p.data) ?? [],
    [proposalsQuery.data],
  );

  const adminProjectsQuery = useQuery({
    ...adminProjectsListQueryOptions(apiClient),
    enabled: isDefaultStaff,
  });
  const adminContributorsQuery = useQuery({
    ...adminContributorsListQueryOptions(apiClient),
    enabled: isDefaultStaff,
  });
  const operatorContext: OperatorContext | undefined = useMemo(() => {
    if (!isDefaultStaff) return undefined;
    return {
      projects: (adminProjectsQuery.data?.data ?? []).map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
      })),
      contributors: (adminContributorsQuery.data?.data ?? []).map((c) => ({
        id: c.nearAccount,
        name: c.name ?? c.nearAccount,
      })),
    };
  }, [isDefaultStaff, adminProjectsQuery.data, adminContributorsQuery.data]);

  const proposalsListProps = {
    proposals,
    isLoading: proposalsQuery.isLoading,
    isError: proposalsQuery.isError,
    onRetry: () => proposalsQuery.refetch(),
    hasNext: !!proposalsQuery.hasNextPage,
    isFetchingNext: proposalsQuery.isFetchingNextPage,
    fetchNextPage: () => proposalsQuery.fetchNextPage(),
    orgAccountId,
    filter: proposalsFilter,
    onFilterChange: setProposalsFilter,
    operatorContext,
  };

  return (
    <div className="flex animate-fade-in flex-col gap-8">
      <PageHeader
        title="Treasury"
        description="Liquid balances and payouts on the Agency DAO contract, live from chain. Every Billing is one of these payouts."
      />

      <Tabs value={activeTab} onValueChange={(t) => setActiveTab(t as TreasuryTab)}>
        <TabsList variant="line">
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
        </TabsList>
        <TabsContent value="balances" className="mt-4">
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
        <TabsContent value="payouts" className="mt-4">
          <ProposalsList {...proposalsListProps} />
        </TabsContent>
      </Tabs>

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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <TokenCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (tokens.length === 0 || visibleTokens.length === 0) {
    return (
      <Empty variant="outline">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CoinsIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{tokens.length === 0 ? "No tokens configured" : "Empty treasury"}</EmptyTitle>
          <EmptyDescription>
            {tokens.length === 0
              ? "No tokens are tracked for this treasury yet."
              : "The DAO holds no balance in any tracked token."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const exportRows = visibleTokens.map((t) => ({
    token: t,
    balance: balanceByToken.get(t.tokenId) ?? "0",
  }));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={view}
          onValueChange={(v) => {
            if (v) onViewChange(v as "grid" | "table");
          }}
          aria-label="Balances view"
        >
          <ToggleGroupItem value="grid">Grid</ToggleGroupItem>
          <ToggleGroupItem value="table">Table</ToggleGroupItem>
        </ToggleGroup>
        <ExportButton
          onExport={() => exportBalancesCsv(exportRows)}
          label="Download visible balances as CSV"
        />
      </div>
      {view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

function ExportButton({
  onExport,
  label,
  disabled,
}: {
  onExport: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onExport}
      disabled={disabled}
      aria-label={label}
    >
      <DownloadSimpleIcon data-icon="inline-start" aria-hidden />
      Export CSV
    </Button>
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

function activateOnKey(action: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      action();
    }
  };
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
    <div className="border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Token</TableHead>
            <TableHead>Network</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead className="hidden sm:table-cell">Contract</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((token) => (
            <TableRow
              key={token.tokenId}
              onClick={() => onSelectToken(token)}
              onKeyDown={activateOnKey(() => onSelectToken(token))}
              tabIndex={0}
              role="button"
              aria-label={`Open ${token.symbol} details`}
              className="cursor-pointer"
            >
              <TableCell className="font-medium">{token.symbol}</TableCell>
              <TableCell className="text-muted-foreground">{token.network}</TableCell>
              <TableCell className="text-right tabular-nums whitespace-nowrap">
                {formatTokenAmount(balanceByToken.get(token.tokenId) ?? "0", token.tokenId)}
              </TableCell>
              <TableCell className="hidden max-w-64 truncate font-mono text-muted-foreground sm:table-cell">
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
      <CardHeader>
        <Skeleton className="h-3 w-16" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-7 w-3/4" />
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
      onKeyDown={activateOnKey(() => onSelect(token))}
      tabIndex={0}
      role="button"
      aria-label={`Open ${token.symbol} details`}
      variant="interactive"
    >
      <CardHeader>
        <CardDescription>
          <span className="block truncate">{token.name}</span>
        </CardDescription>
        <CardAction>
          <Badge variant="outline">{token.network}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="font-heading text-2xl font-semibold tracking-tight tabular-nums break-words">
          {formatTokenAmount(balance, token.tokenId)}
        </p>
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
  const storageQuery = useQuery(tokenStorageStatusQueryOptions(apiClient, token?.tokenId ?? null));
  const tokenTransfers = token
    ? proposals.filter((p) => p.tokenId === token.tokenId).slice(0, 8)
    : [];
  return (
    <Dialog open={!!token} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {token && (
          <>
            <DialogHeader>
              <DialogTitle>{formatTokenAmount(balance, token.tokenId)}</DialogTitle>
              <DialogDescription>
                {token.name} on {token.network}
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DetailField label="Symbol" value={tokenSymbol(token.tokenId)} />
              <DetailField label="Decimals" value={String(token.decimals)} />
              <div className="sm:col-span-2">
                <DetailField label="Contract" value={token.tokenId} mono />
              </div>
              <div className="sm:col-span-2">
                <StorageStatusField
                  tokenId={token.tokenId}
                  isLoading={storageQuery.isLoading}
                  status={storageQuery.data?.status ?? null}
                />
              </div>
            </dl>
            <Separator />
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium">Recent transfers</h3>
              {tokenTransfers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No transfers loaded yet. Open the Payouts tab to load more.
                </p>
              ) : (
                <div className="border">
                  <Table>
                    <TableBody>
                      {tokenTransfers.map((p) => (
                        <TableRow key={p.proposalId}>
                          <TableCell className="text-muted-foreground">#{p.proposalId}</TableCell>
                          <TableCell>
                            <Badge variant={STATUS_VARIANT[p.status] ?? "outline"}>
                              {STATUS_LABEL[p.status] ?? p.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">
                            {formatTokenAmount(p.amount, p.tokenId)}
                          </TableCell>
                          <TableCell className="max-w-48 truncate font-mono text-muted-foreground">
                            {p.receiverId}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
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
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">NEP-145 storage</dt>
      <dd className="text-xs">
        {isNative ? (
          <span className="text-muted-foreground">Not applicable to native NEAR.</span>
        ) : isLoading ? (
          <Skeleton className="h-4 w-32" />
        ) : status ? (
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Registered</Badge>
            <span className="text-muted-foreground tabular-nums">
              Total {formatTokenAmount(status.total, "near")} · available{" "}
              {formatTokenAmount(status.available, "near")}
            </span>
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="destructive">Not registered</Badge>
            <span className="text-muted-foreground">
              The DAO has not registered for this token.
            </span>
          </span>
        )}
      </dd>
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
  return out;
}

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
  { key: "open", label: "Open" },
  { key: "approved", label: "Approved" },
  { key: "failed", label: "Failed" },
  { key: "closed", label: "Closed" },
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

type ProposalsListProps = {
  proposals: Proposal[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
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
  onRetry,
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

  const hasActiveFilter = filter.status.size > 0 || !!filter.token || filter.receiver.trim() !== "";
  const clearFilters = () => onFilterChange(EMPTY_PROPOSALS_FILTER);

  if (isLoading) {
    return (
      <div className="border">
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
    return <LoadError title="Could not load payouts" onRetry={onRetry} />;
  }
  if (proposals.length === 0) {
    return (
      <Empty variant="outline">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ReceiptIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>No payouts yet</EmptyTitle>
          <EmptyDescription>Transfer proposals from the DAO show up here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <ProposalsFilterBar
        statusFilter={filter.status}
        onStatusChange={(status) => onFilterChange({ ...filter, status })}
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
      <div className="border">
        <Table>
          <ProposalsTableHeader />
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No payouts match these filters.
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
        <div className="flex justify-center">
          <Button onClick={fetchNextPage} disabled={isFetchingNext} variant="outline">
            {isFetchingNext && <Spinner data-icon="inline-start" />}
            {isFetchingNext ? "Loading…" : "Load more"}
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
  onStatusChange,
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
  onStatusChange: (next: ReadonlySet<StatusBucket>) => void;
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon>
            <MagnifyingGlassIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            value={receiverQuery}
            onChange={(e) => onReceiverChange(e.target.value)}
            placeholder="Search receiver…"
            aria-label="Filter by receiver account"
          />
        </InputGroup>
        <Select
          value={tokenFilter || ALL_TOKENS_SENTINEL}
          onValueChange={(v) => onTokenChange(v === ALL_TOKENS_SENTINEL ? "" : v)}
        >
          <SelectTrigger aria-label="Filter by token" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TOKENS_SENTINEL}>All tokens</SelectItem>
            {distinctTokens.map((tid) => (
              <SelectItem key={tid} value={tid}>
                {tokenSymbol(tid)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToggleGroup
          type="multiple"
          variant="outline"
          spacing={0}
          value={Array.from(statusFilter)}
          onValueChange={(values) => onStatusChange(new Set(values as StatusBucket[]))}
          aria-label="Filter by status"
        >
          {STATUS_BUCKETS.map((b) => (
            <ToggleGroupItem key={b.key} value={b.key}>
              {b.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {shown === total ? `${total} payouts` : `${shown} of ${total} payouts`}
        </p>
        <div className="flex items-center gap-2">
          {hasActiveFilter && (
            <Button type="button" variant="ghost" size="sm" onClick={onClear}>
              <XIcon data-icon="inline-start" aria-hidden />
              Clear filters
            </Button>
          )}
          <ExportButton
            onExport={onExport}
            disabled={!canExport}
            label="Download visible rows as CSV"
          />
        </div>
      </div>
    </div>
  );
}

function ProposalsTableHeader() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead className="w-16">ID</TableHead>
        <TableHead className="w-28">Status</TableHead>
        <TableHead className="hidden md:table-cell">Description</TableHead>
        <TableHead className="text-right">Amount</TableHead>
        <TableHead>To</TableHead>
        <TableHead className="w-28">Submitted</TableHead>
      </TableRow>
    </TableHeader>
  );
}

const STATUS_LABEL: Record<ProposalStatus, string> = {
  InProgress: "Open",
  Approved: "Approved",
  Rejected: "Rejected",
  Removed: "Removed",
  Expired: "Expired",
  Moved: "Moved",
  Failed: "Failed",
};

type BadgeVariantLocal = "default" | "secondary" | "destructive" | "outline";
const STATUS_VARIANT: Record<ProposalStatus, BadgeVariantLocal> = {
  InProgress: "outline",
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
        <Skeleton className="h-3 w-10" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-16" />
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <Skeleton className="h-3 w-full" />
      </TableCell>
      <TableCell className="text-right">
        <Skeleton className="ml-auto h-3 w-16" />
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

const STATUS_ROW_VARIANT: Record<ProposalStatus, "default" | "muted" | "destructive"> = {
  InProgress: "default",
  Approved: "default",
  Failed: "destructive",
  Rejected: "muted",
  Removed: "muted",
  Expired: "muted",
  Moved: "muted",
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
  return (
    <TableRow
      onClick={() => onSelect(proposal)}
      onKeyDown={activateOnKey(() => onSelect(proposal))}
      tabIndex={0}
      role="button"
      aria-label={`Open proposal ${proposal.proposalId} details`}
      variant={STATUS_ROW_VARIANT[proposal.status]}
      className="cursor-pointer"
    >
      <TableCell className="text-muted-foreground tabular-nums">#{proposal.proposalId}</TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={STATUS_VARIANT[proposal.status] ?? "outline"}>
            {STATUS_LABEL[proposal.status] ?? proposal.status}
          </Badge>
          {showAttribution && proposal.mapping && (
            <Badge variant="outline">@{proposal.mapping.projectSlug}</Badge>
          )}
          {showAttribution && !proposal.mapping && proposal.status === "Approved" && (
            <Badge variant="outline">Unrecorded</Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden max-w-72 min-w-40 whitespace-normal md:table-cell">
        <span className="line-clamp-2 break-words">{proposal.description || "—"}</span>
      </TableCell>
      <TableCell className="text-right tabular-nums whitespace-nowrap">
        {formatTokenAmount(proposal.amount, proposal.tokenId)}
      </TableCell>
      <TableCell className="max-w-44 truncate font-mono text-muted-foreground">
        {proposal.receiverId}
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums whitespace-nowrap">
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
              <DialogTitle>{formatTokenAmount(proposal.amount, proposal.tokenId)}</DialogTitle>
              <DialogDescription>Transfer proposal #{proposal.proposalId}</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd>
                  <Badge variant={STATUS_VARIANT[proposal.status] ?? "outline"}>
                    {STATUS_LABEL[proposal.status] ?? proposal.status}
                  </Badge>
                </dd>
              </div>
              <VoteTally votes={proposal.votes} />
              <DetailField label="Receiver" value={proposal.receiverId} mono />
              <DetailField label="Proposer" value={proposal.proposer} mono />
              <DetailField
                label="Submitted"
                value={formatSubmitted(proposal.submissionTime, "minute")}
              />
              {proposal.description && (
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Description</dt>
                  <dd className="text-xs/relaxed break-words whitespace-pre-wrap">
                    {proposal.description}
                  </dd>
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
            {trezuUrl && (
              <DialogFooter>
                <Button asChild variant="outline">
                  <a href={trezuUrl} target="_blank" rel="noopener noreferrer">
                    View on Trezu
                    <ArrowUpRightIcon data-icon="inline-end" aria-hidden />
                  </a>
                </Button>
              </DialogFooter>
            )}
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
  const [nearAccount, setNearAccount] = useState("");
  const [note, setNote] = useState("");

  const invalidate = () => refreshAfter(queryClient, { type: "billings" });

  const recordMutation = useMutation({
    mutationFn: async () =>
      apiClient.billings.create({
        projectId,
        nearAccount: nearAccount || undefined,
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
        <Separator />
        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-medium">Billing</h3>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              to="/admin/projects/$slug"
              params={{ slug: proposal.mapping.projectSlug }}
              className="text-xs underline underline-offset-4 hover:text-muted-foreground"
            >
              {proposal.mapping.projectTitle || `@${proposal.mapping.projectSlug}`}
            </Link>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete billing"}
            </Button>
          </div>
        </section>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={`Delete billing for proposal #${proposal.proposalId}?`}
          description="You can re-record it afterwards. Chain status remains the source of truth."
          confirmLabel="Delete"
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
      <>
        <Separator />
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-medium">Billing</h3>
          <p className="text-xs text-muted-foreground">
            Create a Project before recording Billings.
          </p>
        </section>
      </>
    );
  }

  const projectFieldId = `record-project-${proposal.proposalId}`;
  const contributorFieldId = `record-contributor-${proposal.proposalId}`;
  const noteFieldId = `record-note-${proposal.proposalId}`;
  const canRecord = projectId !== "" && !recordMutation.isPending;
  return (
    <>
      <Separator />
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-medium">Record billing</h3>
          <p className="text-xs text-muted-foreground">
            Attribute this payout to a Project so its Clients see it.
          </p>
        </div>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={projectFieldId}>Project</FieldLabel>
            <Select
              value={projectId}
              onValueChange={setProjectId}
              disabled={recordMutation.isPending}
            >
              <SelectTrigger id={projectFieldId} className="w-full">
                <SelectValue placeholder="Select a Project" />
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
          <Field>
            <FieldLabel htmlFor={contributorFieldId}>Contributor</FieldLabel>
            <Select
              value={nearAccount || NO_CONTRIBUTOR_SENTINEL}
              onValueChange={(v) => setNearAccount(v === NO_CONTRIBUTOR_SENTINEL ? "" : v)}
              disabled={recordMutation.isPending}
            >
              <SelectTrigger id={contributorFieldId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CONTRIBUTOR_SENTINEL}>None</SelectItem>
                {contributors.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={noteFieldId}>Note</FieldLabel>
            <Input
              id={noteFieldId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={recordMutation.isPending}
              maxLength={2000}
              placeholder="Optional"
            />
          </Field>
        </FieldGroup>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {projectId === "" && (
            <p className="text-xs text-muted-foreground">Select a Project to record.</p>
          )}
          <Button onClick={() => recordMutation.mutate()} disabled={!canRecord}>
            {recordMutation.isPending && <Spinner data-icon="inline-start" />}
            {recordMutation.isPending ? "Recording…" : "Record billing"}
          </Button>
        </div>
      </section>
    </>
  );
}

function VoteTally({ votes }: { votes: Record<string, VoteAction> }) {
  const entries = Object.values(votes);
  const counts = { Approve: 0, Reject: 0, Remove: 0 };
  for (const v of entries) counts[v]++;
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">Votes</dt>
      {entries.length === 0 ? (
        <dd className="text-xs text-muted-foreground">No tally available</dd>
      ) : (
        <dd className="flex flex-wrap items-center gap-3 text-xs tabular-nums">
          <span>
            <span className="text-muted-foreground">Approve</span> {counts.Approve}
          </span>
          <span>
            <span className="text-muted-foreground">Reject</span> {counts.Reject}
          </span>
          {counts.Remove > 0 && (
            <span>
              <span className="text-muted-foreground">Remove</span> {counts.Remove}
            </span>
          )}
        </dd>
      )}
    </div>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs break-all" : "text-xs break-words"}>{value}</dd>
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
