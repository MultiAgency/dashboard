import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { warnIfPayoutsUncovered } from "@/lib/payout-coverage";
import { openPendingTab, type PendingTab } from "@/lib/pending-tab";
import {
  adminContributorsListQueryOptions,
  adminProjectsListQueryOptions,
  adminWorkOrdersQueryKey,
  adminWorkOrdersQueryOptions,
  tokensListQueryOptions,
  workOrderIntegrationQueryOptions,
  workOrderNextCodeQueryOptions,
  workOrderRepresentativeQueryOptions,
} from "@/lib/queries";
import { defaultRepresentative } from "@/lib/representative";
import { defaultPeriod, duplicateTitle, recentBudgets, todayIn } from "@/lib/work-order-defaults";
import { BudgetChips } from "./budget-chips";
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
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const GITHUB_LOGIN = /^[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function repoFromProject(repository: string | null | undefined): string {
  if (!repository) return "";
  const match = /github\.com\/([^/]+\/[^/#?]+)/i.exec(repository);
  return (match?.[1] ?? repository).replace(/\.git$/, "");
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
        <Empty label="No tokens yet" description="No tokens are configured for this network." />
      </>
    );
  }
  if (lists.projects.length === 0 || lists.builders.length === 0) {
    return (
      <>
        {title}
        <Empty
          label={lists.projects.length === 0 ? "No projects yet" : "No builders yet"}
          description="A work order links one builder to one project. Add them first."
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
  const [draft, setDraft] = useState<Draft>(() => {
    const defaults = defaultRepresentative(representative, me);
    const source = editing ?? template;
    if (source) {
      const period = editing
        ? { start: editing.periodStart, end: editing.periodEnd }
        : nextCycle(source.periodStart, source.periodEnd);
      return {
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
      };
    }
    const period = defaultPeriod(todayIn(listQuery.data?.data[0]?.timeZone));
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
  });
  const [custom, setCustom] = useState<Record<string, string>>(
    () => (editing ?? template)?.customFields ?? {},
  );
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
  const badRepo = repos.find((r) => !REPO.test(r));
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
      if (intent === "draft") {
        toast.success(`${created.code} created as a draft`);
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
          toast.success(`${offered.code} created and offered to the builder`);
        }
        await warnIfPayoutsUncovered(queryClient, apiClient, offered.id);
        return offered;
      } catch (err) {
        tab?.close();
        toast.error(
          `${created.code} is saved as a draft but wasn't offered: ${(err as Error).message || "something went wrong"}`,
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
  const badEmail = [draft.contractorEmail, draft.representativeEmail]
    .map((e) => e.trim())
    .find((e) => e !== "" && !EMAIL.test(e));
  const badRepresentativeEmail =
    draft.representativeEmail.trim() !== "" && !EMAIL.test(draft.representativeEmail.trim());
  const [moreShown, setMoreOpen] = useState(!!editing || !!template);
  const moreOpen = moreShown || badRepresentativeEmail;
  const reason = !draft.projectId
    ? "Choose a project."
    : !draft.builderNearAccount
      ? "Choose a builder."
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
                : !/^\d+$/.test(draft.graceDays)
                  ? "Grace days must be a whole number."
                  : badGithub
                    ? "The GitHub login has letters, digits and single dashes only."
                    : badEmail
                      ? `${badEmail} isn't an email address.`
                      : null;
  const primary: Intent = editing ? "draft" : "sign";
  const [confirmingResign, setConfirmingResign] = useState(false);
  const resigns = !!editing && editing.status !== "draft";
  const submit = (intent: Intent, confirmed = false) => {
    if (reason || save.isPending) return;
    if (resigns && !confirmed) {
      setConfirmingResign(true);
      return;
    }
    const tab = intent === "sign" ? openPendingTab("Preparing the document to sign…") : null;
    save.mutate({ intent, tab });
  };

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
          A period, a budget cap and the repositories in scope for one builder on one project. It
          starts as a draft; the builder accepts the terms from their own account.
          {editing && editing.status !== "draft"
            ? " Changing a term sends it back to draft, so the builder accepts it again."
            : ""}
        </DialogDescription>
      </DialogHeader>
      {!editing && <SetupPreflight />}
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          <Field label="Project" htmlFor="wo-project">
            <ChoiceSelect
              id="wo-project"
              value={draft.projectId}
              placeholder="Choose a project"
              onValueChange={(value) => {
                const project = projects.find((p) => p.id === value);
                setDraft((current) => ({
                  ...current,
                  projectId: value,
                  repos: current.repos || repoFromProject(project?.repository),
                }));
              }}
              options={projects.map((p) => ({ value: p.id, label: p.title }))}
            />
          </Field>
          <Field label="Builder" htmlFor="wo-builder" helper="Their NEAR account is paid.">
            <ChoiceSelect
              id="wo-builder"
              value={draft.builderNearAccount}
              placeholder="Choose a builder"
              onValueChange={(value) => {
                const builder = builders.find((b) => b.nearAccount === value);
                setDraft((current) => ({
                  ...current,
                  builderNearAccount: value,
                  githubLogin: builder?.githubLogin ?? "",
                }));
              }}
              options={builders.map((b) => ({
                value: b.nearAccount,
                label: `${b.name ?? b.nearAccount}${b.githubLogin ? ` · @${b.githubLogin}` : " · no GitHub login"}`,
              }))}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_2fr] sm:items-start">
          <Field
            label="Code"
            htmlFor="wo-code"
            helper={
              nextCodeQuery.data
                ? `Optional, e.g. SI-004. Left empty it's ${nextCodeQuery.data.code}.`
                : "Optional, e.g. SI-004. Default WO-0001…"
            }
          >
            <Input
              id="wo-code"
              value={draft.code}
              placeholder={editing ? undefined : nextCodeQuery.data?.code}
              onChange={(e) => set("code", e.target.value)}
            />
          </Field>
          <Field label="Title" htmlFor="wo-title">
            <Input
              id="wo-title"
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>
        </div>
        <Field
          label="Authorized work"
          htmlFor="wo-scope"
          helper="Optional. Shown to the builder with the terms."
        >
          <Textarea
            id="wo-scope"
            rows={3}
            value={draft.scope}
            onChange={(e) => set("scope", e.target.value)}
          />
        </Field>
        <Field
          label="GitHub repositories"
          htmlFor="wo-repos"
          helper="owner/name, one per line. Work counts once the repository owner approves or merges it."
        >
          <Textarea
            id="wo-repos"
            rows={2}
            value={draft.repos}
            onChange={(e) => set("repos", e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3 sm:items-start">
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
          <Field label="Grace days" htmlFor="wo-grace" helper="For work merged just after.">
            <Input
              id="wo-grace"
              inputMode="numeric"
              value={draft.graceDays}
              onChange={(e) => set("graceDays", e.target.value)}
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
        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          <Field
            label="Builder's GitHub login"
            htmlFor="wo-github"
            helper={
              selectedBuilder && !selectedBuilder.githubLogin
                ? "Missing on their profile: add it here. Their work is found by it."
                : "Their work is found by it. Part of the terms."
            }
          >
            <Input
              id="wo-github"
              placeholder="octocat"
              value={draft.githubLogin}
              aria-invalid={badGithub}
              onChange={(e) => set("githubLogin", e.target.value)}
            />
          </Field>
          <Field
            label="Builder's email"
            htmlFor="wo-contractor-email"
            helper="Where the work order emails go. Optional if they have a MultiAgency account."
          >
            <Input
              id="wo-contractor-email"
              type="email"
              value={draft.contractorEmail}
              onChange={(e) => set("contractorEmail", e.target.value)}
            />
          </Field>
        </div>
        {askFields.map((field) => (
          <Field
            key={field.tag}
            label={field.label}
            htmlFor={`wo-custom-${field.tag}`}
            helper="Asked by your document template."
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
        <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="self-start px-0">
              {moreOpen ? "Hide options" : "More options: representative, IP model, renewal"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-4 pt-2">
            <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
              <Field
                label="Representative"
                htmlFor="wo-rep-name"
                helper="Signs for the Agency; printed on the document."
              >
                <Input
                  id="wo-rep-name"
                  value={draft.representativeName}
                  onChange={(e) => set("representativeName", e.target.value)}
                />
              </Field>
              <Field
                label="Representative's email"
                htmlFor="wo-rep-email"
                helper="Agency emails (payout requested, signed, renewed) go only to this address."
              >
                <Input
                  id="wo-rep-email"
                  type="email"
                  value={draft.representativeEmail}
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
              <FieldLabel htmlFor="wo-renew" className="flex flex-col items-start gap-0.5">
                <span>Renew monthly when the base metrics are met</span>
                <span className="text-xs font-normal text-muted-foreground">
                  At the end of each period the work is measured. All met: next month's work order
                  starts by itself. Any missed: Manual Approval Needed. Part of the accepted terms.
                </span>
              </FieldLabel>
            </ShadcnField>
          </CollapsibleContent>
        </Collapsible>
      </FieldGroup>
      <DialogFooter className="flex-wrap items-center gap-3">
        {reason && <p className="mr-auto text-xs text-muted-foreground">{reason}</p>}
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
              disabled={reason !== null || save.isPending}
            >
              {save.isPending && save.variables?.intent === "sign"
                ? "Creating…"
                : "Create and sign"}
            </Button>
          </>
        )}
      </DialogFooter>
    </form>
  );
}
