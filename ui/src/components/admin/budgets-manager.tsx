import { ArrowRightIcon, ListBulletsIcon, WarningIcon } from "@phosphor-icons/react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Alert,
  AlertDescription,
  Badge,
  Budget,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  FieldGroup,
  Input,
  Skeleton,
  SubcontractorSpend,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { ChoiceSelect, Empty, Field } from "@/components/admin-form";
import { useBudgetActions } from "@/hooks/use-budget-actions";
import {
  reconcileBudgetAuditFilters,
  resolveBudgetAuditDropdownOptions,
} from "@/lib/admin-filter-graph";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import {
  adminBudgetsLogQueryKey,
  adminProjectBudgetQueryOptions,
  adminProjectBudgetsLogQueryKey,
  adminProjectsForTokenQueryKey,
  adminProjectsListQueryOptions,
  adminTokensQueryOptions,
  clientPortalProjectBudgetQueryOptions,
  engagementsListQueryOptions,
  refreshAfter,
} from "@/lib/queries";
import { CUSTOM_TOKEN, deriveBaseAmount, TokenAmountFields } from "./token-amount-fields";

function budgetVerb(amount: string, relatedBudgetId: string | null): string {
  const negative = amount.startsWith("-");
  if (relatedBudgetId) return negative ? "transfer out" : "transfer in";
  return negative ? "deallocate" : "budget";
}

function VerbTag({ verb }: { verb: string }) {
  return (
    <Badge variant={verb === "deallocate" || verb === "transfer out" ? "outline" : "secondary"}>
      {verb}
    </Badge>
  );
}

function formatTimestamp(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 16).replace("T", " ");
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

function LoadMore({
  hasNextPage,
  isFetching,
  onLoad,
}: {
  hasNextPage: boolean;
  isFetching: boolean;
  onLoad: () => void;
}) {
  if (!hasNextPage) return null;
  return (
    <div className="flex justify-center">
      <Button variant="outline" size="sm" onClick={onLoad} disabled={isFetching}>
        {isFetching ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
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
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Project budget</h2>
          </CardTitle>
          <CardDescription>
            Pick a project to see its budget per token and record entries.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {projectsQuery.isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No projects yet. Create one on{" "}
              <Link to="/admin/projects" className="underline underline-offset-2">
                the projects page
              </Link>
              .
            </p>
          ) : (
            <Field label="Project" htmlFor="budget-project">
              <ChoiceSelect
                id="budget-project"
                value={projectId}
                onValueChange={setProjectId}
                placeholder="Pick a project"
                options={projects.map((p) => ({ value: p.id, label: `${p.title} (@${p.slug})` }))}
              />
            </Field>
          )}
        </CardContent>
      </Card>

      {selectedProject && <ProjectBudgetPanel projectId={projectId} />}

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

  const tokensQuery = useQuery(adminTokensQueryOptions(apiClient));
  const tokens = tokensQuery.data?.tokens ?? [];

  const [filterProject, setFilterProject] = useState<string>("");
  const [filterToken, setFilterToken] = useState<string>("");
  const [filterEngagement, setFilterEngagement] = useState<string>("");

  const engagementsQuery = useQuery(engagementsListQueryOptions(apiClient));
  const engagements = useMemo(
    () =>
      (engagementsQuery.data?.data ?? []).filter(
        (e) => e.side === "agency" && (e.status === "active" || e.status === "ended"),
      ),
    [engagementsQuery.data],
  );
  const engagementById = useMemo(() => new Map(engagements.map((e) => [e.id, e])), [engagements]);

  const engagementProjectIds = useMemo(() => {
    if (!filterEngagement) return null;
    return new Set(engagementById.get(filterEngagement)?.projectIds ?? []);
  }, [filterEngagement, engagementById]);

  const projectBudgetQuery = useQuery({
    ...adminProjectBudgetQueryOptions(apiClient, filterProject),
    enabled: !!filterProject,
  });

  const projectsForTokenQuery = useQuery({
    queryKey: adminProjectsForTokenQueryKey(filterToken),
    queryFn: async () => {
      const result = await apiClient.budgets.list({ tokenId: filterToken, limit: 200 });
      return new Set(result.data.map((row) => row.projectId));
    },
    enabled: !!filterToken,
    staleTime: 60_000,
  });

  const tokensByProject = useMemo(() => {
    if (!filterProject) return null;
    const ids = projectBudgetQuery.data?.budgets.map((b) => b.tokenId) ?? [];
    return ids.length > 0 ? new Set(ids) : null;
  }, [filterProject, projectBudgetQuery.data?.budgets]);

  const projectsByToken = projectsForTokenQuery.data ?? null;
  const allProjectIds = useMemo(() => projects.map((p) => p.id), [projects]);
  const allTokenIds = useMemo(() => tokens.map((t) => t.tokenId), [tokens]);

  const dropdownOptions = useMemo(
    () =>
      resolveBudgetAuditDropdownOptions(
        allProjectIds,
        allTokenIds,
        { projectId: filterProject, tokenId: filterToken },
        projectsByToken,
        tokensByProject,
      ),
    [allProjectIds, allTokenIds, filterProject, filterToken, projectsByToken, tokensByProject],
  );

  const filterProjects = useMemo(
    () =>
      projects.filter(
        (p) =>
          dropdownOptions.projects.has(p.id) &&
          (!engagementProjectIds || engagementProjectIds.has(p.id)),
      ),
    [projects, dropdownOptions.projects, engagementProjectIds],
  );
  const filterTokens = useMemo(
    () => tokens.filter((t) => dropdownOptions.tokens.has(t.tokenId)),
    [tokens, dropdownOptions.tokens],
  );

  const applyAuditFilters = (patch: Partial<{ projectId: string; tokenId: string }>) => {
    const next = reconcileBudgetAuditFilters(
      { projectId: filterProject, tokenId: filterToken },
      patch,
      allProjectIds,
      allTokenIds,
      projectsByToken,
      tokensByProject,
    );
    setFilterProject(next.projectId);
    setFilterToken(next.tokenId);
  };

  const logQuery = useInfiniteQuery({
    queryKey: adminBudgetsLogQueryKey({
      projectId: filterProject || null,
      tokenId: filterToken || null,
      engagementId: filterEngagement || null,
    }),
    queryFn: ({ pageParam }) =>
      apiClient.budgets.list({
        projectId: filterProject || undefined,
        tokenId: filterToken || undefined,
        engagementId: filterEngagement || undefined,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const rows = logQuery.data?.pages.flatMap((p) => p.data) ?? [];
  const filtersActive = filterProject !== "" || filterToken !== "" || filterEngagement !== "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Agency audit log</h2>
        </CardTitle>
        <CardDescription>
          All budget events across projects, newest first. Transfers appear as two linked rows.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-44">
            <ChoiceSelect
              id="audit-filter-engagement"
              ariaLabel="Client"
              size="sm"
              value={filterEngagement}
              onValueChange={(value) => {
                setFilterEngagement(value);
                if (value && filterProject) {
                  const allowed = engagementById.get(value)?.projectIds ?? [];
                  if (!allowed.includes(filterProject)) setFilterProject("");
                }
              }}
              emptyLabel="All clients"
              options={engagements.map((e) => ({ value: e.id, label: e.client.name }))}
            />
          </div>
          <div className="w-full sm:w-44">
            <ChoiceSelect
              id="audit-filter-project"
              ariaLabel="Project"
              size="sm"
              value={filterProject}
              onValueChange={(value) => applyAuditFilters({ projectId: value })}
              emptyLabel="All projects"
              options={filterProjects.map((p) => ({ value: p.id, label: p.title }))}
            />
          </div>
          <div className="w-full sm:w-44">
            <ChoiceSelect
              id="audit-filter-token"
              ariaLabel="Token"
              size="sm"
              value={filterToken}
              onValueChange={(value) => applyAuditFilters({ tokenId: value })}
              emptyLabel="All tokens"
              options={filterTokens.map((t) => ({ value: t.tokenId, label: t.symbol }))}
            />
          </div>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilterEngagement("");
                applyAuditFilters({ projectId: "", tokenId: "" });
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
        {logQuery.isLoading ? (
          <ListSkeleton />
        ) : rows.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">When</TableHead>
                  <TableHead scope="col">Event</TableHead>
                  <TableHead scope="col">Amount</TableHead>
                  <TableHead scope="col">Project</TableHead>
                  <TableHead scope="col">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => {
                  const project = projectById.get(a.projectId);
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {formatTimestamp(a.createdAt)}
                      </TableCell>
                      <TableCell>
                        <VerbTag verb={budgetVerb(a.amount, a.relatedBudgetId)} />
                      </TableCell>
                      <TableCell className="font-medium tabular-nums">
                        {formatTokenAmount(a.amount, a.tokenId)}
                      </TableCell>
                      <TableCell>
                        {project ? project.title : a.projectId}
                        {a.engagementId && (
                          <span className="block text-muted-foreground">
                            {engagementById.get(a.engagementId)?.client.name ?? a.engagementId}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-normal text-muted-foreground">
                        {a.note && <span className="block text-foreground">{a.note}</span>}
                        <span className="block">by {a.actorAccountId}</span>
                        {a.fundingDaoAccountId && (
                          <span className="block">from {a.fundingDaoAccountId}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <LoadMore
              hasNextPage={!!logQuery.hasNextPage}
              isFetching={logQuery.isFetchingNextPage}
              onLoad={() => logQuery.fetchNextPage()}
            />
          </>
        ) : (
          <Empty
            icon={<ListBulletsIcon aria-hidden />}
            label={filtersActive ? "No events match these filters" : "No budget events yet"}
          />
        )}
      </CardContent>
    </Card>
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
    ...adminProjectBudgetQueryOptions(apiClient, fromProjectId),
    enabled: fromProjectId !== "",
  });
  const toBudgetQuery = useQuery({
    ...adminProjectBudgetQueryOptions(apiClient, toProjectId),
    enabled: toProjectId !== "",
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
      await refreshAfter(queryClient, {
        type: "budgetEntries",
        projectIds: [fromProjectId, toProjectId],
      });
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

  const fromTitle = projects.find((p) => p.id === fromProjectId)?.title ?? "Source";
  const toTitle = projects.find((p) => p.id === toProjectId)?.title ?? "Destination";

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Transfer between projects</h2>
        </CardTitle>
        <CardDescription>
          Moves your own budget atomically, as two linked audit rows. Budget attributed to a
          Client's Engagement moves only through Change orders.
        </CardDescription>
      </CardHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) transferMutation.mutate();
        }}
      >
        <CardContent>
          <FieldGroup>
            <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
              <Field label="From project" htmlFor="transfer-from">
                <ChoiceSelect
                  id="transfer-from"
                  value={fromProjectId}
                  onValueChange={setFromProjectId}
                  disabled={isPending}
                  options={projects.map((p) => ({ value: p.id, label: `${p.title} (@${p.slug})` }))}
                />
              </Field>
              <Field label="To project" htmlFor="transfer-to">
                <ChoiceSelect
                  id="transfer-to"
                  value={toProjectId}
                  onValueChange={setToProjectId}
                  disabled={isPending}
                  placeholder="Pick a project"
                  options={projects
                    .filter((p) => p.id !== fromProjectId)
                    .map((p) => ({ value: p.id, label: `${p.title} (@${p.slug})` }))}
                />
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
              <dl className="grid gap-3 text-xs sm:grid-cols-2">
                {[
                  { title: fromTitle, before: fromCurrent, after: fromAfter },
                  { title: toTitle, before: toCurrent, after: toAfter },
                ].map((side) => (
                  <div key={side.title} className="flex min-w-0 flex-col gap-1 bg-muted p-3">
                    <dt className="truncate text-muted-foreground">{side.title}</dt>
                    <dd className="flex flex-wrap items-center gap-2 tabular-nums">
                      <span>{formatTokenAmount(side.before.toString(), effectiveTokenId)}</span>
                      <ArrowRightIcon aria-hidden className="text-muted-foreground" />
                      <span className={side.after < 0n ? "text-destructive" : "font-medium"}>
                        {formatTokenAmount(side.after.toString(), effectiveTokenId)}
                      </span>
                    </dd>
                  </div>
                ))}
                {knownToken && (
                  <p className="text-muted-foreground tabular-nums sm:col-span-2">
                    {amount.trim()} {knownToken.symbol} = {amountInBase} base units
                  </p>
                )}
              </dl>
            )}
            <Field label="Note" htmlFor="transfer-note">
              <Input
                id="transfer-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional"
                disabled={isPending}
              />
            </Field>
            {sourceWillGoNegative && (
              <Alert variant="destructive">
                <WarningIcon aria-hidden />
                <AlertDescription>
                  The source budget goes negative after this transfer. It's allowed, and flagged in
                  the audit log.
                </AlertDescription>
              </Alert>
            )}
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={!canSubmit}>
            {isPending ? "Transferring…" : "Transfer budget"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export function ProjectBudgetPanel({
  projectId,
  readOnly = false,
  showAgencyBudgetLink = false,
  engagementId,
}: {
  projectId: string;
  readOnly?: boolean;
  showAgencyBudgetLink?: boolean;
  engagementId?: string;
}) {
  const apiClient = useApiClient();
  const clientPortal = engagementId !== undefined;
  const { allocate, deallocate } = useBudgetActions(projectId);

  const adminBudgetQuery = useQuery({
    ...adminProjectBudgetQueryOptions(apiClient, projectId),
    enabled: !clientPortal,
  });
  const clientBudgetQuery = useQuery({
    ...clientPortalProjectBudgetQueryOptions(apiClient, engagementId ?? "", projectId),
    enabled: clientPortal,
  });
  const budgetQuery = clientPortal ? clientBudgetQuery : adminBudgetQuery;
  const budgetsQuery = useInfiniteQuery({
    queryKey: adminProjectBudgetsLogQueryKey(projectId),
    queryFn: ({ pageParam }) => apiClient.budgets.list({ projectId, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !readOnly && !clientPortal,
  });

  const budgetRows = budgetsQuery.data?.pages.flatMap((p) => p.data) ?? [];

  const tokensQuery = useQuery({
    ...adminTokensQueryOptions(apiClient),
    enabled: !readOnly && !clientPortal,
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

  if (budgetQuery.isError) {
    return <AdminError error={budgetQuery.error} />;
  }

  const hasBudget =
    !!budgetQuery.data &&
    (budgetQuery.data.budgets.length > 0 || budgetQuery.data.subcontractorSpend.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Budget</h2>
          </CardTitle>
          <CardDescription>
            Budgeted, allocated, committed and paid amounts per token.
          </CardDescription>
          {showAgencyBudgetLink && (
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link to="/admin/budgets">
                  Transfers
                  <ArrowRightIcon data-icon="inline-end" aria-hidden />
                </Link>
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {budgetQuery.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : hasBudget && budgetQuery.data ? (
            <div className="flex flex-col gap-4">
              {budgetQuery.data.budgets.map((b) => (
                <Budget key={b.tokenId} budget={b} />
              ))}
              <SubcontractorSpend
                rows={budgetQuery.data.subcontractorSpend}
                title={
                  budgetQuery.data.budgets.length > 0
                    ? "Paid by subcontractors, apart from this budget"
                    : "Paid from your Agency DAO"
                }
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No budget recorded yet.</p>
          )}
        </CardContent>
      </Card>

      {!readOnly && !clientPortal && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Record a budget entry</h2>
            </CardTitle>
            <CardDescription>
              Recorded to the audit log; nothing is executed on-chain. Budgets may go negative.
            </CardDescription>
          </CardHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) createMutation.mutate();
            }}
          >
            <CardContent>
              <FieldGroup>
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
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground tabular-nums">
                    <span>{effectiveTokenId} budget</span>
                    <span>
                      {formatTokenAmount(currentBudgetBigInt.toString(), effectiveTokenId)}
                    </span>
                    <ArrowRightIcon aria-hidden />
                    <span
                      className={
                        previewBudgetBigInt < 0n
                          ? "text-destructive"
                          : "font-medium text-foreground"
                      }
                    >
                      {formatTokenAmount(previewBudgetBigInt.toString(), effectiveTokenId)}
                    </span>
                    {knownToken && (
                      <span>
                        ({amount.trim()} {knownToken.symbol} = {amountInBase})
                      </span>
                    )}
                  </p>
                )}
                <Field label="Note" htmlFor="budget-note">
                  <Input
                    id="budget-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional"
                    disabled={isPending}
                  />
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => deallocateMutation.mutate()}
                disabled={!canSubmit}
              >
                {deallocateMutation.isPending ? "Recording…" : "Record deallocation"}
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {createMutation.isPending ? "Recording…" : "Record budget"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      {!clientPortal && !readOnly && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Audit log</h2>
            </CardTitle>
            <CardDescription>Every budget event on this project, newest first.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {budgetsQuery.isLoading ? (
              <ListSkeleton />
            ) : budgetRows.length > 0 ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">When</TableHead>
                      <TableHead scope="col">Event</TableHead>
                      <TableHead scope="col">Amount</TableHead>
                      <TableHead scope="col">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {budgetRows.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {formatTimestamp(a.createdAt)}
                        </TableCell>
                        <TableCell>
                          <VerbTag verb={budgetVerb(a.amount, a.relatedBudgetId)} />
                        </TableCell>
                        <TableCell className="font-medium tabular-nums">
                          {formatTokenAmount(a.amount, a.tokenId)}
                        </TableCell>
                        <TableCell className="whitespace-normal text-muted-foreground">
                          {a.note && <span className="block text-foreground">{a.note}</span>}
                          <span className="block">by {a.actorAccountId}</span>
                          {a.fundingDaoAccountId && (
                            <span className="block">from {a.fundingDaoAccountId}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <LoadMore
                  hasNextPage={!!budgetsQuery.hasNextPage}
                  isFetching={budgetsQuery.isFetchingNextPage}
                  onLoad={() => budgetsQuery.fetchNextPage()}
                />
              </>
            ) : (
              <Empty icon={<ListBulletsIcon aria-hidden />} label="No budget events yet" />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
