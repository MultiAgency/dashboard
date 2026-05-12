import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Budget, Button, Card, CardContent, Input } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Field, selectClass } from "@/components/admin-form";
import {
  CUSTOM_TOKEN,
  deriveBaseAmount,
  TokenAmountFields,
} from "@/components/token-amount-fields";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";

export const Route = createFileRoute("/_layout/_authenticated/_configured/admin/allocations")({
  head: () => ({
    meta: [{ title: "Admin · Allocations" }],
  }),
  component: AdminAllocations,
});

function AdminAllocations() {
  const apiClient = useApiClient();
  const projectsQuery = useQuery({
    queryKey: ["admin", "projects", "list"],
    queryFn: () => apiClient.projects.adminList(),
    retry: false,
  });

  const [projectId, setProjectId] = useState<string>("");

  if (projectsQuery.isError) {
    return <AdminError error={projectsQuery.error} />;
  }

  const projects = projectsQuery.data?.data ?? [];
  const selectedProject = projects.find((p) => p.id === projectId);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Allocations</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Allocate Trezu treasury into a project's budget. Each allocation is recorded with the
          actor's NEAR account and a timestamp — the row list is the audit log.
        </p>
      </header>

      <Treasury />

      <Card>
        <CardContent className="p-5">
          {projectsQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading projects...</div>
          ) : projects.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No projects yet. Create one on{" "}
              <Link to="/admin/projects" className="underline">
                the projects page
              </Link>
              .
            </div>
          ) : (
            <Field label="project" htmlFor="alloc-project">
              <select
                id="alloc-project"
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

      {selectedProject && <ProjectAllocationPanel projectId={projectId} />}

      {projects.length >= 2 && <TransferPanel projects={projects} />}

      {projects.length > 0 && <AgencyAuditLogPanel projects={projects} />}
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

  const tokensQuery = useQuery({
    queryKey: ["admin", "tokens"],
    queryFn: () => apiClient.tokens.list(),
    staleTime: 60 * 60_000,
  });
  const tokens = tokensQuery.data?.tokens ?? [];

  const [filterProject, setFilterProject] = useState<string>("");
  const [filterToken, setFilterToken] = useState<string>("");

  const logQuery = useInfiniteQuery({
    queryKey: ["admin", "allocations", "agency", filterProject || null, filterToken || null],
    queryFn: ({ pageParam }) =>
      apiClient.allocations.adminList({
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
      <h2 className="text-lg font-semibold tracking-tight">Agency audit log</h2>
      <p className="text-sm text-muted-foreground max-w-2xl">
        All allocation events across projects, newest first. Transfers between projects appear as
        two linked rows.
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
                  <div className="text-sm break-all">
                    <div className="font-mono tabular-nums">
                      {formatTokenAmount(a.amount, a.tokenId)}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-1">
                      project: {project ? `${project.title} (@${project.slug})` : a.projectId}
                    </div>
                    {a.note && <div className="text-xs text-muted-foreground">{a.note}</div>}
                    <div className="text-xs text-muted-foreground font-mono mt-1">
                      by {a.actorAccountId}
                      {a.relatedAllocationId ? " · linked transfer" : ""}
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
            No allocations yet.
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

  const tokensQuery = useQuery({
    queryKey: ["admin", "tokens"],
    queryFn: () => apiClient.tokens.list(),
    staleTime: 60 * 60_000,
  });
  const tokens = tokensQuery.data?.tokens ?? [];

  const isCustom = tokenSelection === CUSTOM_TOKEN;
  const effectiveTokenId = isCustom ? customTokenId.trim() : tokenSelection;
  const knownToken = tokens.find((t) => t.tokenId === effectiveTokenId);
  const { value: amountInBase, error: amountError } = deriveBaseAmount(amount, knownToken);

  const fromBudgetQuery = useQuery({
    queryKey: ["admin", "projects", "budget", fromProjectId],
    queryFn: () => apiClient.projects.getBudget({ projectId: fromProjectId }),
    enabled: fromProjectId !== "",
    staleTime: 30_000,
  });
  const toBudgetQuery = useQuery({
    queryKey: ["admin", "projects", "budget", toProjectId],
    queryFn: () => apiClient.projects.getBudget({ projectId: toProjectId }),
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
      apiClient.allocations.adminTransfer({
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
        queryClient.invalidateQueries({ queryKey: ["admin", "allocations", fromProjectId] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "allocations", toProjectId] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "allocations", "agency"] }),
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
      <h2 className="text-lg font-semibold tracking-tight">Transfer between projects</h2>
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
            project's remaining budget is allowed to go negative; over-allocation is shown visually,
            not blocked.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

function ProjectAllocationPanel({ projectId }: { projectId: string }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  const budgetQuery = useQuery({
    queryKey: ["admin", "projects", "budget", projectId],
    queryFn: () => apiClient.projects.getBudget({ projectId }),
  });
  const allocsQuery = useInfiniteQuery({
    queryKey: ["admin", "allocations", projectId],
    queryFn: ({ pageParam }) => apiClient.allocations.adminList({ projectId, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const allocs = allocsQuery.data?.pages.flatMap((p) => p.data) ?? [];

  const tokensQuery = useQuery({
    queryKey: ["admin", "tokens"],
    queryFn: () => apiClient.tokens.list(),
    staleTime: 60 * 60_000,
  });
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
      queryClient.invalidateQueries({ queryKey: ["admin", "allocations", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "projects", "budget", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "allocations", "agency"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "treasury", "balances"] }),
    ]);

  const createMutation = useMutation({
    mutationFn: async () =>
      apiClient.allocations.adminCreate({
        projectId,
        tokenId: effectiveTokenId,
        amount: amountInBase,
        note: note.trim() || undefined,
      }),
    onSuccess: async () => {
      await invalidateAfterMutation();
      setAmount("");
      setNote("");
      toast.success("Allocation recorded");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to record allocation"),
  });

  const deallocateMutation = useMutation({
    mutationFn: async () =>
      apiClient.allocations.adminDeallocate({
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
        <h2 className="text-lg font-semibold tracking-tight">Budget</h2>
        {budgetQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading budget...</div>
        ) : budgetQuery.data && budgetQuery.data.budgets.length > 0 ? (
          <div className="space-y-4">
            {budgetQuery.data.budgets.map((b) => (
              <Budget key={b.tokenId} budget={b} />
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No allocations yet.</div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">New allocation</h2>
        <Card>
          <CardContent className="p-5 grid gap-4">
            <TokenAmountFields
              idPrefix="alloc"
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
            <Field label="note (optional)" htmlFor="alloc-note">
              <Input
                id="alloc-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={isPending}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => createMutation.mutate()} disabled={!canSubmit}>
                {createMutation.isPending ? "recording..." : "record allocation"}
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
              to go negative — over-allocation is shown visually, not blocked.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Audit log</h2>
        {allocsQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading allocations...</div>
        ) : allocs.length > 0 ? (
          <>
            <div className="space-y-2">
              {allocs.map((a) => (
                <div
                  key={a.id}
                  className="rounded-sm border border-border bg-muted/10 p-3 grid gap-1 sm:grid-cols-[140px_1fr_auto] sm:gap-4"
                >
                  <div className="text-xs font-mono text-muted-foreground">
                    {new Date(a.createdAt).toISOString().slice(0, 19).replace("T", " ")}
                  </div>
                  <div className="text-sm break-all">
                    <div className="font-mono tabular-nums">
                      {formatTokenAmount(a.amount, a.tokenId)}
                    </div>
                    {a.note && <div className="text-xs text-muted-foreground">{a.note}</div>}
                    <div className="text-xs text-muted-foreground font-mono mt-1">
                      by {a.actorAccountId}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {allocsQuery.hasNextPage && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => allocsQuery.fetchNextPage()}
                  disabled={allocsQuery.isFetchingNextPage}
                >
                  {allocsQuery.isFetchingNextPage ? "loading..." : "load more"}
                </Button>
              </div>
            )}
          </>
        ) : (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No allocations recorded yet.
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

function Treasury() {
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

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">Treasury</h2>
      <p className="text-sm text-muted-foreground max-w-2xl">
        Live balances on the agency's Sputnik DAO contract, with the agency's allocated total per
        token across all projects.
      </p>
      {balancesQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading treasury…</div>
      ) : balancesQuery.isError ? (
        <div className="text-sm text-muted-foreground">Treasury unavailable.</div>
      ) : (
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
                      <span className="font-mono text-foreground">
                        {formatTokenAmount(balance, t.tokenId)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>allocated</span>
                      <span
                        className={`font-mono ${overAllocated ? "text-destructive" : "text-foreground"}`}
                      >
                        {formatTokenAmount(allocated, t.tokenId)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>free</span>
                      <span
                        className={`font-mono ${overAllocated ? "text-destructive" : "text-foreground"}`}
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
      )}
    </section>
  );
}
