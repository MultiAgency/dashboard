import { ArrowSquareOutIcon, GithubLogoIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import {
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldGroup,
  Input,
  Textarea,
} from "@/components";
import { deriveBaseAmount, type KnownToken } from "@/components/admin/token-amount-fields";
import { AdminError } from "@/components/admin-error";
import { ChoiceSelect, Empty, Field, Loading } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FieldLabel, Field as ShadcnField } from "@/components/ui/field";
import { type ApiClient, useApiClient } from "@/lib/api";
import { sessionQueryOptions } from "@/lib/auth";
import { nextCycle } from "@/lib/budget-periods";
import { baseToDecimal, tokenSymbol } from "@/lib/format-amount";
import { getNetwork } from "@/lib/network";
import { warnIfPayoutsUncovered } from "@/lib/payout-coverage";
import { openPendingTab, type PendingTab } from "@/lib/pending-tab";
import {
  activeOrganizationKey,
  adminContributorsListQueryOptions,
  adminProjectsListQueryOptions,
  adminWorkOrdersQueryKey,
  adminWorkOrdersQueryOptions,
  tokensListQueryOptions,
  workOrderBuilderDefaultsQueryOptions,
  workOrderIntegrationQueryOptions,
  workOrderNextCodeQueryOptions,
  workOrderRepresentativeQueryOptions,
} from "@/lib/queries";
import { defaultRepresentative } from "@/lib/representative";
import {
  defaultPeriod,
  duplicateTitle,
  GITHUB_REPO,
  recentBudgets,
  repoFromProject,
  sendBlocker,
  todayIn,
} from "@/lib/work-order-defaults";
import {
  clearWorkOrderDraft,
  mergeStoredDraft,
  readWorkOrderDraft,
  type WorkOrderDraftScope,
  withLivePeriod,
  writeWorkOrderDraft,
} from "@/lib/work-order-draft";
import { BudgetChips } from "./budget-chips";
import { GithubRepoPicker } from "./github-repo-picker";
import { QuickCreateBuilder } from "./quick-create-builder";
import { QuickCreateProject } from "./quick-create-project";
import { SetupPreflight } from "./setup-checklist";
import type { WorkOrder } from "./work-order-status";

type Draft = {
  code: string;
  projectId: string;
  builderNearAccount: string;
  title: string;
  scope: string;
  repos: string;
  periodStart: string;
  periodEnd: string;
  graceDays: string;
  tokenId: string;
  amount: string;
  autoRenew: boolean;
  githubLogin: string;
  contractorEmail: string;
  representativeName: string;
  representativeEmail: string;
  ipModel: string;
};

const IP_MODELS = [
  { value: "assignment", label: "IP assignment to the client" },
  { value: "license", label: "License to the client" },
  { value: "open_source", label: "Open source" },
];

const USD = "usd";
const NEAR = "near";
const USD_DECIMALS = 6;
const GITHUB_LOGIN = /^[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NEW_ITEM = "__new__";

function isDirty(draft: Draft, custom: Record<string, string>): boolean {
  return (
    [draft.projectId, draft.builderNearAccount, draft.title, draft.repos, draft.amount, draft.scope]
      .map((value) => value.trim())
      .some(Boolean) || Object.values(custom).some((value) => value.trim() !== "")
  );
}

function amountOf(budgetAmount: string, tokenId: string, tokens: Lists["tokens"]): string {
  if (tokenId === USD) return baseToDecimal(budgetAmount, USD_DECIMALS);
  const token = tokens.find((t) => t.tokenId === tokenId);
  return token ? baseToDecimal(budgetAmount, token.decimals) : budgetAmount;
}

type Intent = "draft" | "sign";

function formTitle(editing?: WorkOrder, template?: WorkOrder): string {
  if (editing) return `Edit ${editing.code}`;
  return template ? `New from ${template.code}` : "New work order";
}

type Lists = {
  projects: Awaited<ReturnType<ApiClient["agency"]["projects"]["listOwned"]>>["data"];
  builders: Awaited<ReturnType<ApiClient["contributors"]["list"]>>["data"];
  tokens: Awaited<ReturnType<ApiClient["tokens"]["list"]>>["tokens"];
  representative: Awaited<ReturnType<ApiClient["workOrders"]["representativeDefaults"]>> | null;
  askFields: { tag: string; label: string }[];
};

export function WorkOrderForm({
  editing,
  template,
  onDone,
}: {
  editing?: WorkOrder;
  template?: WorkOrder;
  onDone: (workOrder: WorkOrder) => void;
}) {
  const apiClient = useApiClient();
  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));
  const buildersQuery = useQuery(adminContributorsListQueryOptions(apiClient));
  const tokensQuery = useQuery(tokensListQueryOptions(apiClient));
  const representativeQuery = useQuery(workOrderRepresentativeQueryOptions(apiClient));
  const integrationQuery = useQuery(workOrderIntegrationQueryOptions(apiClient));
  const failed = projectsQuery.error ?? buildersQuery.error ?? tokensQuery.error;
  const title = (
    <DialogHeader>
      <DialogTitle>{formTitle(editing, template)}</DialogTitle>
    </DialogHeader>
  );
  if (failed) {
    return (
      <>
        {title}
        <AdminError error={failed} />
      </>
    );
  }
  if (
    !projectsQuery.data ||
    !buildersQuery.data ||
    !tokensQuery.data ||
    representativeQuery.isLoading ||
    integrationQuery.isLoading
  ) {
    return (
      <>
        {title}
        <Loading label="Loading projects, builders and tokens" />
      </>
    );
  }
  const lists: Lists = {
    projects: projectsQuery.data.data,
    builders: buildersQuery.data.data,
    tokens: tokensQuery.data.tokens.filter((t) => t.tokenId),
    representative: representativeQuery.data ?? null,
    askFields: integrationQuery.data?.google.askFields ?? [],
  };
  if (lists.tokens.length === 0 && !editing) {
    return (
      <>
        {title}
        <Empty
          label="Payments aren't set up on this network"
          description="Builders are paid in NEAR, and no payment tokens are configured here yet. Ask the platform admin to add NEAR."
        />
      </>
    );
  }
  return <WorkOrderFields editing={editing} template={template} onDone={onDone} {...lists} />;
}

function WorkOrderFields({
  editing,
  template,
  onDone,
  projects,
  builders,
  tokens,
  representative,
  askFields,
}: Lists & {
  editing?: WorkOrder;
  template?: WorkOrder;
  onDone: (workOrder: WorkOrder) => void;
}) {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const me = useQuery(sessionQueryOptions(authClient)).data?.user;
  const listQuery = useQuery(adminWorkOrdersQueryOptions(apiClient));
  const nextCodeQuery = useQuery({
    ...workOrderNextCodeQueryOptions(apiClient),
    enabled: !editing,
  });
  const budgetChoices = editing ? [] : recentBudgets(listQuery.data?.data ?? []);
  const [draftScope] = useState<WorkOrderDraftScope | null>(() =>
    me?.id
      ? { userId: me.id, network: getNetwork(), organizationId: activeOrganizationKey() }
      : null,
  );
  const keepsLocalDraft = !editing && !template && draftScope !== null;
  const today = () => todayIn(listQuery.data?.data[0]?.timeZone);
  const blank = (): Draft => {
    const defaults = defaultRepresentative(representative, me);
    const period = defaultPeriod(today());
    return {
      code: "",
      projectId: "",
      builderNearAccount: "",
      title: "",
      scope: "",
      repos: "",
      periodStart: period.start,
      periodEnd: period.end,
      graceDays: "2",
      tokenId: USD,
      amount: "",
      autoRenew: false,
      githubLogin: "",
      contractorEmail: "",
      representativeName: defaults.name,
      representativeEmail: defaults.email,
      ipModel: "",
    };
  };
  const [initial] = useState(() => {
    const source = editing ?? template;
    if (source) {
      const defaults = defaultRepresentative(representative, me);
      const period = editing
        ? { start: editing.periodStart, end: editing.periodEnd }
        : nextCycle(source.periodStart, source.periodEnd);
      return {
        restored: false,
        custom: source.customFields ?? {},
        draft: {
          code: editing ? editing.code : "",
          projectId: source.projectId,
          builderNearAccount: source.builder.nearAccount,
          title: editing
            ? source.title
            : duplicateTitle(source.title, source.periodStart, period.start),
          scope: source.scope ?? "",
          repos: source.repos.join("\n"),
          periodStart: period.start,
          periodEnd: period.end,
          graceDays: String(source.graceDays),
          tokenId: source.tokenId,
          amount: amountOf(source.budgetAmount, source.tokenId, tokens),
          autoRenew: source.autoRenew,
          githubLogin: source.builder.githubLogin ?? "",
          contractorEmail: source.contractorEmail ?? "",
          representativeName: source.representativeName ?? (editing ? "" : defaults.name),
          representativeEmail: source.representativeEmail ?? (editing ? "" : defaults.email),
          ipModel: source.ipModel ?? "",
        } satisfies Draft,
      };
    }
    const fresh = blank();
    const stored = keepsLocalDraft && draftScope ? readWorkOrderDraft<Draft>(draftScope) : null;
    if (!stored) return { restored: false, custom: {}, draft: fresh };
    const merged = withLivePeriod(mergeStoredDraft(fresh, stored.draft), fresh, today());
    const draft: Draft = {
      ...merged,
      code: "",
      projectId: projects.some((p) => p.id === merged.projectId) ? merged.projectId : "",
      builderNearAccount: builders.some((b) => b.nearAccount === merged.builderNearAccount)
        ? merged.builderNearAccount
        : "",
    };
    return isDirty(draft, stored.custom)
      ? { restored: true, custom: stored.custom, draft }
      : { restored: false, custom: {}, draft: fresh };
  });
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [custom, setCustom] = useState<Record<string, string>>(initial.custom);
  const [restored, setRestored] = useState(initial.restored);
  const finished = useRef(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingBuilder, setCreatingBuilder] = useState(false);
  const [importingRepos, setImportingRepos] = useState(false);

  useEffect(() => {
    if (!keepsLocalDraft || !draftScope || finished.current) return;
    if (isDirty(draft, custom)) {
      const { representativeName: _name, representativeEmail: _email, ...kept } = draft;
      writeWorkOrderDraft(draftScope, { draft: kept, custom });
    } else clearWorkOrderDraft(draftScope);
  }, [keepsLocalDraft, draftScope, draft, custom]);

  const builderDefaultsQuery = useQuery(
    workOrderBuilderDefaultsQueryOptions(apiClient, draft.builderNearAccount),
  );
  const builderDefaults = builderDefaultsQuery.data;
  const builderAccount = draft.builderNearAccount;
  useEffect(() => {
    if (editing || !builderDefaults || !builderAccount) return;
    setDraft((current) => {
      if (current.builderNearAccount !== builderAccount) return current;
      const githubLogin = current.githubLogin || builderDefaults.githubLogin || "";
      const contractorEmail = current.contractorEmail || builderDefaults.contractorEmail || "";
      return githubLogin === current.githubLogin && contractorEmail === current.contractorEmail
        ? current
        : { ...current, githubLogin, contractorEmail };
    });
  }, [editing, builderDefaults, builderAccount]);

  const discard = () => {
    finished.current = false;
    if (draftScope) clearWorkOrderDraft(draftScope);
    setDraft(blank());
    setCustom({});
    setRestored(false);
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const token =
    draft.tokenId === USD
      ? ({ tokenId: USD, symbol: "USD", decimals: USD_DECIMALS } as KnownToken)
      : tokens.find((t) => t.tokenId === draft.tokenId);
  const { value: budgetAmount, error: amountError } = deriveBaseAmount(draft.amount, token);
  const repos = draft.repos
    .split(/[\s,]+/)
    .map((r) => r.trim())
    .filter(Boolean);
  const badRepo = repos.find((r) => !GITHUB_REPO.test(r));
  const validRepos = repos.filter((r) => GITHUB_REPO.test(r));
  const toggleRepo = (repo: string, checked: boolean) =>
    setDraft((current) => {
      const lines = current.repos
        .split(/[\s,]+/)
        .map((r) => r.trim())
        .filter(Boolean);
      const others = lines.filter((r) => r.toLowerCase() !== repo.toLowerCase());
      return { ...current, repos: (checked ? [...others, repo] : others).join("\n") };
    });
  const tokenId = draft.tokenId || tokens[0]?.tokenId || "";

  const save = useMutation({
    mutationFn: async ({ intent, tab }: { intent: Intent; tab: PendingTab | null }) => {
      const fields = {
        projectId: draft.projectId,
        builderNearAccount: draft.builderNearAccount,
        title: draft.title.trim(),
        scope: draft.scope.trim() || null,
        repos,
        periodStart: draft.periodStart,
        periodEnd: draft.periodEnd,
        graceDays: Number(draft.graceDays),
        tokenId,
        payoutTokenId: tokenId === USD ? NEAR : null,
        budgetAmount,
        autoRenew: draft.autoRenew,
        githubLogin: draft.githubLogin.trim().replace(/^@/, "") || null,
        contractorEmail: draft.contractorEmail.trim() || null,
        representativeName: draft.representativeName.trim() || null,
        representativeEmail: draft.representativeEmail.trim() || null,
        ipModel: draft.ipModel || null,
        ...(askFields.length > 0 || editing || template
          ? {
              customFields: Object.fromEntries(
                Object.entries(custom)
                  .map(([tag, value]) => [tag, value.trim()])
                  .filter(([, value]) => value !== ""),
              ),
            }
          : {}),
        ...(draft.code.trim() ? { code: draft.code.trim() } : {}),
      };
      if (editing) return apiClient.workOrders.update({ id: editing.id, ...fields });
      const created = await apiClient.workOrders.create(fields);
      finished.current = true;
      if (draftScope) clearWorkOrderDraft(draftScope);
      if (intent === "draft") {
        toast.success(`${created.code} saved as a draft`);
        return created;
      }
      try {
        const offered = await apiClient.workOrders.offer({ id: created.id });
        const next = offered.progress.next;
        if (next?.kind === "link" && next.external) {
          tab?.go(next.href);
          toast.success(`${offered.code} created: sign it in Documenso to send it to the builder`);
        } else {
          tab?.close();
          toast.success(`${offered.code} sent to the builder`);
        }
        await warnIfPayoutsUncovered(queryClient, apiClient, offered.id);
        return offered;
      } catch (err) {
        tab?.close();
        toast.error(
          `${created.code} is saved as a draft but wasn't sent: ${(err as Error).message || "something went wrong"}`,
        );
        return created;
      }
    },
    onSuccess: async (workOrder) => {
      await queryClient.invalidateQueries({ queryKey: adminWorkOrdersQueryKey });
      if (editing) toast.success(`${workOrder.code} updated`);
      onDone(workOrder);
    },
    onError: (err: Error, { tab }) => {
      tab?.close();
      toast.error(err.message || "Failed to save the work order");
    },
  });

  const selectedBuilder = builders.find((b) => b.nearAccount === draft.builderNearAccount);
  const github = draft.githubLogin.trim().replace(/^@/, "");
  const badGithub = github !== "" && !GITHUB_LOGIN.test(github);
  const contractorEmail = draft.contractorEmail.trim();
  const representativeEmail = draft.representativeEmail.trim();
  const badContractorEmail = contractorEmail !== "" && !EMAIL.test(contractorEmail);
  const badRepresentativeEmail = representativeEmail !== "" && !EMAIL.test(representativeEmail);
  const badGrace = !/^\d+$/.test(draft.graceDays);
  const builderChosen = draft.builderNearAccount !== "";
  const githubInMain =
    builderChosen && !selectedBuilder?.githubLogin && !builderDefaults?.githubLogin;
  const emailInMain =
    builderChosen &&
    !!builderDefaults?.needsEmails &&
    !builderDefaults.contractorEmail &&
    !builderDefaults.accountEmail;
  const reason = !draft.builderNearAccount
    ? "Choose a builder."
    : !draft.projectId
      ? "Choose a project."
      : !draft.title.trim()
        ? "Give the work order a title."
        : repos.length === 0
          ? "Add at least one GitHub repository."
          : badRepo
            ? `${badRepo} isn't owner/name.`
            : !draft.periodStart || !draft.periodEnd || draft.periodEnd < draft.periodStart
              ? "The period must end on or after its start."
              : !budgetAmount || amountError
                ? amountError || "Enter the budget."
                : badGrace
                  ? "Grace days must be a whole number."
                  : badGithub
                    ? "The GitHub login has letters, digits and single dashes only."
                    : badContractorEmail
                      ? `${contractorEmail} isn't an email address.`
                      : badRepresentativeEmail
                        ? `${representativeEmail} isn't an email address.`
                        : null;
  const checking = builderChosen && builderDefaultsQuery.isLoading;
  const checkFailed = builderChosen && builderDefaultsQuery.isError;
  const blocker = editing
    ? null
    : checking
      ? { reason: "Checking the builder's details…", inDetails: false }
      : checkFailed
        ? { reason: "Couldn't check the builder's details ·", inDetails: false }
        : sendBlocker({
            githubLogin: github,
            contractorEmail,
            representativeEmail,
            needsEmails: builderDefaults?.needsEmails ?? false,
            accountEmail: builderDefaults?.accountEmail ?? false,
          });
  const detailsNeeded =
    badGrace ||
    badRepresentativeEmail ||
    (badGithub && !githubInMain) ||
    (badContractorEmail && !emailInMain) ||
    (!reason && !!blocker?.inDetails);
  const [detailsShown, setDetailsShown] = useState(!!editing || !!template);
  const detailsOpen = detailsShown || detailsNeeded;
  const primary: Intent = editing ? "draft" : "sign";
  const [confirmingResign, setConfirmingResign] = useState(false);
  const resigns = !!editing && editing.status !== "draft";
  const submit = (intent: Intent, confirmed = false) => {
    if (reason || save.isPending) return;
    if (intent === "sign" && blocker) return;
    if (resigns && !confirmed) {
      setConfirmingResign(true);
      return;
    }
    const tab = intent === "sign" ? openPendingTab("Preparing the document to sign…") : null;
    save.mutate({ intent, tab });
  };

  const githubField = (
    <Field
      label="Builder's GitHub login"
      htmlFor="wo-github"
      helper={githubInMain ? "Not on their profile yet. Their work is found by it." : undefined}
    >
      <Input
        id="wo-github"
        placeholder="octocat"
        value={draft.githubLogin}
        aria-invalid={badGithub}
        onChange={(e) => set("githubLogin", e.target.value)}
      />
    </Field>
  );
  const emailField = (
    <Field
      label="Builder's email"
      htmlFor="wo-contractor-email"
      helper={emailInMain ? "The signing request goes here." : "Where their work order emails go."}
    >
      <Input
        id="wo-contractor-email"
        type="email"
        value={draft.contractorEmail}
        aria-invalid={badContractorEmail}
        onChange={(e) => set("contractorEmail", e.target.value)}
      />
    </Field>
  );

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter;
        submit(submitter?.getAttribute("value") === "sign" ? "sign" : "draft");
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
        e.preventDefault();
        submit(primary);
      }}
    >
      <DialogHeader>
        <DialogTitle>{formTitle(editing, template)}</DialogTitle>
        <DialogDescription>
          One builder, one project: the repositories, a period and a budget cap. The builder accepts
          the terms from their own account.
          {editing && editing.status !== "draft"
            ? " Changing a term sends it back to draft, so the builder accepts it again."
            : ""}
        </DialogDescription>
      </DialogHeader>
      {!editing && <SetupPreflight />}
      {restored && (
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          Restored your unsent work order ·
          <Button type="button" variant="link" size="xs" onClick={discard}>
            Discard
          </Button>
        </p>
      )}
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          <Field label="Builder" htmlFor="wo-builder" helper="Their NEAR account is paid.">
            {builders.length === 0 || creatingBuilder ? (
              <QuickCreateBuilder
                onCancel={builders.length > 0 ? () => setCreatingBuilder(false) : undefined}
                onCreated={(builder) => {
                  setCreatingBuilder(false);
                  setDraft((current) => ({
                    ...current,
                    builderNearAccount: builder.nearAccount,
                    githubLogin: builder.githubLogin ?? "",
                    contractorEmail: "",
                  }));
                }}
              />
            ) : (
              <ChoiceSelect
                id="wo-builder"
                value={draft.builderNearAccount}
                placeholder="Choose a builder"
                onValueChange={(value) => {
                  if (value === NEW_ITEM) {
                    setCreatingBuilder(true);
                    return;
                  }
                  const builder = builders.find((b) => b.nearAccount === value);
                  setDraft((current) => ({
                    ...current,
                    builderNearAccount: value,
                    githubLogin: builder?.githubLogin ?? "",
                    contractorEmail: "",
                  }));
                }}
                options={[
                  ...builders.map((b) => ({
                    value: b.nearAccount,
                    label: `${b.name ?? b.nearAccount}${b.githubLogin ? ` · @${b.githubLogin}` : ""}`,
                  })),
                  { value: NEW_ITEM, label: "+ New builder" },
                ]}
              />
            )}
          </Field>
          <Field label="Project" htmlFor="wo-project">
            {projects.length === 0 || creatingProject ? (
              <QuickCreateProject
                onCancel={projects.length > 0 ? () => setCreatingProject(false) : undefined}
                onCreated={(project) => {
                  setCreatingProject(false);
                  setDraft((current) => ({
                    ...current,
                    projectId: project.id,
                    repos: current.repos.trim()
                      ? current.repos
                      : repoFromProject(project.repository),
                  }));
                }}
              />
            ) : (
              <ChoiceSelect
                id="wo-project"
                value={draft.projectId}
                placeholder="Choose a project"
                onValueChange={(value) => {
                  if (value === NEW_ITEM) {
                    setCreatingProject(true);
                    return;
                  }
                  const project = projects.find((p) => p.id === value);
                  setDraft((current) => ({
                    ...current,
                    projectId: value,
                    repos: current.repos.trim()
                      ? current.repos
                      : repoFromProject(project?.repository),
                  }));
                }}
                options={[
                  ...projects.map((p) => ({ value: p.id, label: p.title })),
                  { value: NEW_ITEM, label: "+ New project" },
                ]}
              />
            )}
          </Field>
        </div>
        <Field label="Title" htmlFor="wo-title">
          <Input id="wo-title" value={draft.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field
          label="GitHub repositories"
          htmlFor="wo-repos"
          helper="owner/name, one per line. Work counts once it's approved or merged."
        >
          <Textarea
            id="wo-repos"
            rows={2}
            value={draft.repos}
            onChange={(e) => set("repos", e.target.value)}
          />
          {validRepos.length > 0 && (
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Repository links">
              {validRepos.map((repo) => (
                <li key={repo}>
                  <a
                    href={`https://github.com/${repo}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    {repo}
                    <ArrowSquareOutIcon aria-hidden className="size-3" />
                  </a>
                </li>
              ))}
            </ul>
          )}
          {importingRepos ? (
            <GithubRepoPicker
              selected={repos}
              onToggle={toggleRepo}
              onClose={() => setImportingRepos(false)}
            />
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => setImportingRepos(true)}
            >
              <GithubLogoIcon data-icon="inline-start" aria-hidden />
              Import from GitHub
            </Button>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          <Field label="Period start" htmlFor="wo-start">
            <Input
              id="wo-start"
              type="date"
              value={draft.periodStart}
              onChange={(e) => set("periodStart", e.target.value)}
            />
          </Field>
          <Field label="Period end" htmlFor="wo-end">
            <Input
              id="wo-end"
              type="date"
              value={draft.periodEnd}
              onChange={(e) => set("periodEnd", e.target.value)}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          <Field label="Budget in" htmlFor="wo-token">
            <ChoiceSelect
              id="wo-token"
              value={tokenId}
              onValueChange={(value) =>
                setDraft((current) => ({ ...current, tokenId: value, amount: "" }))
              }
              options={[
                { value: USD, label: "USD (paid in NEAR at the live price)" },
                { value: NEAR, label: "NEAR" },
                ...(tokenId !== USD && tokenId !== NEAR && tokenId
                  ? [{ value: tokenId, label: tokenSymbol(tokenId) }]
                  : []),
              ]}
            />
          </Field>
          <Field
            label={tokenId === USD ? "Budget cap (USD)" : "Budget cap"}
            htmlFor="wo-amount"
            helper="A maximum, not a guarantee."
          >
            <Input
              id="wo-amount"
              inputMode="decimal"
              value={draft.amount}
              aria-invalid={!!amountError}
              onChange={(e) => set("amount", e.target.value)}
            />
            <BudgetChips
              choices={budgetChoices}
              onPick={(choice) =>
                setDraft((current) => ({
                  ...current,
                  tokenId: choice.tokenId,
                  amount: amountOf(choice.budgetAmount, choice.tokenId, tokens),
                }))
              }
            />
          </Field>
        </div>
        {(githubInMain || emailInMain) && (
          <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
            {githubInMain && githubField}
            {emailInMain && emailField}
          </div>
        )}
        {askFields.map((field) => (
          <Field
            key={field.tag}
            label={field.label}
            htmlFor={`wo-custom-${field.tag}`}
            helper="Printed in your document."
          >
            <Input
              id={`wo-custom-${field.tag}`}
              value={custom[field.tag] ?? ""}
              onChange={(e) =>
                setCustom((current) => ({ ...current, [field.tag]: e.target.value }))
              }
            />
          </Field>
        ))}
        <Collapsible open={detailsOpen} onOpenChange={setDetailsShown}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="self-start">
              {detailsOpen ? "Hide details" : "Details"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex flex-col gap-4 pt-2">
              <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
                <Field
                  label="Code"
                  htmlFor="wo-code"
                  helper={
                    nextCodeQuery.data
                      ? `Left empty it's ${nextCodeQuery.data.code}.`
                      : "Left empty it's numbered for you."
                  }
                >
                  <Input
                    id="wo-code"
                    value={draft.code}
                    placeholder={editing ? undefined : nextCodeQuery.data?.code}
                    onChange={(e) => set("code", e.target.value)}
                  />
                </Field>
                <Field label="Grace days" htmlFor="wo-grace" helper="For work merged just after.">
                  <Input
                    id="wo-grace"
                    inputMode="numeric"
                    value={draft.graceDays}
                    aria-invalid={badGrace}
                    onChange={(e) => set("graceDays", e.target.value)}
                  />
                </Field>
              </div>
              <Field
                label="Authorized work"
                htmlFor="wo-scope"
                helper="Shown to the builder with the terms."
              >
                <Textarea
                  id="wo-scope"
                  rows={3}
                  value={draft.scope}
                  onChange={(e) => set("scope", e.target.value)}
                />
              </Field>
              {(!githubInMain || !emailInMain) && (
                <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
                  {!githubInMain && githubField}
                  {!emailInMain && emailField}
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
                <Field label="Representative" htmlFor="wo-rep-name" helper="Signs for the Agency.">
                  <Input
                    id="wo-rep-name"
                    value={draft.representativeName}
                    onChange={(e) => set("representativeName", e.target.value)}
                  />
                </Field>
                <Field
                  label="Representative's email"
                  htmlFor="wo-rep-email"
                  helper="Agency emails go only here."
                >
                  <Input
                    id="wo-rep-email"
                    type="email"
                    value={draft.representativeEmail}
                    aria-invalid={badRepresentativeEmail || (!reason && !!blocker?.inDetails)}
                    onChange={(e) => set("representativeEmail", e.target.value)}
                  />
                </Field>
              </div>
              <Field label="IP model" htmlFor="wo-ip" helper="Printed on the document.">
                <ChoiceSelect
                  id="wo-ip"
                  value={draft.ipModel}
                  emptyLabel="Not specified"
                  onValueChange={(value) => set("ipModel", value)}
                  options={IP_MODELS}
                />
              </Field>
              <ShadcnField orientation="horizontal">
                <Checkbox
                  id="wo-renew"
                  checked={draft.autoRenew}
                  onCheckedChange={(checked) => set("autoRenew", checked === true)}
                />
                <FieldLabel htmlFor="wo-renew" className="flex flex-col items-start">
                  <span>Renew monthly when the base metrics are met</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    Each period is measured at its end. All met: next month's work order starts by
                    itself. Any missed: you decide. Part of the accepted terms.
                  </span>
                </FieldLabel>
              </ShadcnField>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </FieldGroup>
      <DialogFooter className="flex-wrap items-center">
        {(reason ?? blocker?.reason) && (
          <p className="mr-auto flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {reason ?? blocker?.reason}
            {!reason && checkFailed && (
              <Button
                type="button"
                variant="link"
                size="xs"
                disabled={builderDefaultsQuery.isFetching}
                onClick={() => void builderDefaultsQuery.refetch()}
              >
                {builderDefaultsQuery.isFetching ? "Trying…" : "Try again"}
              </Button>
            )}
          </p>
        )}
        {editing ? (
          <>
            <Button type="submit" value="draft" disabled={reason !== null || save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
            <ConfirmDialog
              open={confirmingResign}
              onOpenChange={setConfirmingResign}
              title="Save and send it for signature again?"
              description={`Changing a term cancels the signatures so far: ${editing.builder.name ?? editing.builder.nearAccount} has to sign it again. Edits that don't touch the terms keep the signatures.`}
              confirmLabel="Save changes"
              onConfirm={() => submit("draft", true)}
            />
          </>
        ) : (
          <>
            <Button
              type="submit"
              value="draft"
              variant="outline"
              disabled={reason !== null || save.isPending}
            >
              {save.isPending && save.variables?.intent === "draft" ? "Saving…" : "Save draft"}
            </Button>
            <Button
              type="submit"
              value="sign"
              title="Ctrl or ⌘ + Enter"
              disabled={reason !== null || blocker !== null || save.isPending}
            >
              {save.isPending && save.variables?.intent === "sign"
                ? "Sending…"
                : "Send for signature"}
            </Button>
          </>
        )}
      </DialogFooter>
    </form>
  );
}
