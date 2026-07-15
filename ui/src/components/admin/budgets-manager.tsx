import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Budget, Button, Card, CardContent, Input } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Field, selectClass } from "@/components/admin-form";
import { useBudgetActions } from "@/hooks/use-budget-actions";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount, parseDecimalToBase } from "@/lib/format-amount";
import { adminProjectsListQueryOptions, adminTokensQueryOptions } from "@/lib/queries";

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

export function BudgetsManager() {
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
              <Link to="/admin/projects" className="underline">
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

export function ProjectBudgetPanel({ projectId }: { projectId: string }) {
  const apiClient = useApiClient();
  const { allocate, deallocate } = useBudgetActions(projectId);

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

  const createMutation = {
    isPending: allocate.isPending,
    mutate: () => {
      allocate.mutate(
        {
          tokenId: effectiveTokenId,
          amount: amountInBase,
          note: note.trim() || undefined,
        },
        {
          onSuccess: () => {
            setAmount("");
            setNote("");
          },
        },
      );
    },
  };

  const deallocateMutation = {
    isPending: deallocate.isPending,
    mutate: () => {
      deallocate.mutate(
        {
          tokenId: effectiveTokenId,
          amount: amountInBase,
          note: note.trim() || undefined,
        },
        {
          onSuccess: () => {
            setAmount("");
            setNote("");
          },
        },
      );
    },
  };

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
