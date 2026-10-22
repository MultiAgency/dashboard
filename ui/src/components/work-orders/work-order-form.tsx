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
import { Checkbox } from "@/components/ui/checkbox";
import { FieldLabel, Field as ShadcnField } from "@/components/ui/field";
import { type ApiClient, useApiClient } from "@/lib/api";
import { sessionQueryOptions } from "@/lib/auth";
import { baseToDecimal, tokenSymbol } from "@/lib/format-amount";
import {
  adminContributorsListQueryOptions,
  adminProjectsListQueryOptions,
  adminWorkOrdersQueryKey,
  tokensListQueryOptions,
} from "@/lib/queries";
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

function monthOf(date: Date): { start: string; end: string } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

type Lists = {
  projects: Awaited<ReturnType<ApiClient["agency"]["projects"]["listOwned"]>>["data"];
  builders: Awaited<ReturnType<ApiClient["contributors"]["list"]>>["data"];
  tokens: Awaited<ReturnType<ApiClient["tokens"]["list"]>>["tokens"];
};

export function WorkOrderForm({
  editing,
  onDone,
}: {
  editing?: WorkOrder;
  onDone: (workOrder: WorkOrder) => void;
}) {
  const apiClient = useApiClient();
  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));
  const buildersQuery = useQuery(adminContributorsListQueryOptions(apiClient));
  const tokensQuery = useQuery(tokensListQueryOptions(apiClient));
  const failed = projectsQuery.error ?? buildersQuery.error ?? tokensQuery.error;
  const title = (
    <DialogHeader>
      <DialogTitle>{editing ? `Edit ${editing.code}` : "New work order"}</DialogTitle>
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
  if (!projectsQuery.data || !buildersQuery.data || !tokensQuery.data) {
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
  return <WorkOrderFields editing={editing} onDone={onDone} {...lists} />;
}

function WorkOrderFields({
  editing,
  onDone,
  projects,
  builders,
  tokens,
}: Lists & {
  editing?: WorkOrder;
  onDone: (workOrder: WorkOrder) => void;
}) {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const me = useQuery(sessionQueryOptions(authClient)).data?.user;
  const month = monthOf(new Date());
  const [draft, setDraft] = useState<Draft>(() => {
    const token = editing ? tokens.find((t) => t.tokenId === editing.tokenId) : undefined;
    return editing
      ? {
          code: editing.code,
          projectId: editing.projectId,
          builderNearAccount: editing.builder.nearAccount,
          title: editing.title,
          scope: editing.scope ?? "",
          repos: editing.repos.join("\n"),
          periodStart: editing.periodStart,
          periodEnd: editing.periodEnd,
          graceDays: String(editing.graceDays),
          tokenId: editing.tokenId,
          amount:
            editing.tokenId === USD
              ? baseToDecimal(editing.budgetAmount, USD_DECIMALS)
              : token
                ? baseToDecimal(editing.budgetAmount, token.decimals)
                : editing.budgetAmount,
          autoRenew: editing.autoRenew,
          githubLogin: editing.builder.githubLogin ?? "",
          contractorEmail: editing.contractorEmail ?? "",
          representativeName: editing.representativeName ?? "",
          representativeEmail: editing.representativeEmail ?? "",
          ipModel: editing.ipModel ?? "",
        }
      : {
          code: "",
          projectId: "",
          builderNearAccount: "",
          title: "",
          scope: "",
          repos: "",
          periodStart: month.start,
          periodEnd: month.end,
          graceDays: "2",
          tokenId: USD,
          amount: "",
          autoRenew: false,
          githubLogin: "",
          contractorEmail: "",
          representativeName: me?.name ?? "",
          representativeEmail: me?.email ?? "",
          ipModel: "",
        };
  });
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
    mutationFn: async () => {
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
        ...(draft.code.trim() ? { code: draft.code.trim() } : {}),
      };
      return editing
        ? apiClient.workOrders.update({ id: editing.id, ...fields })
        : apiClient.workOrders.create(fields);
    },
    onSuccess: async (workOrder) => {
      await queryClient.invalidateQueries({ queryKey: adminWorkOrdersQueryKey });
      toast.success(editing ? `${workOrder.code} updated` : `${workOrder.code} created as a draft`);
      onDone(workOrder);
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save the work order"),
  });

  const selectedBuilder = builders.find((b) => b.nearAccount === draft.builderNearAccount);
  const github = draft.githubLogin.trim().replace(/^@/, "");
  const badGithub = github !== "" && !GITHUB_LOGIN.test(github);
  const badEmail = [draft.contractorEmail, draft.representativeEmail]
    .map((e) => e.trim())
    .find((e) => e !== "" && !EMAIL.test(e));
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

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason && !save.isPending) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing ? `Edit ${editing.code}` : "New work order"}</DialogTitle>
        <DialogDescription>
          A period, a budget cap and the repositories in scope for one builder on one project. It
          starts as a draft; the builder accepts the terms from their own account.
          {editing && editing.status !== "draft"
            ? " Changing a term sends it back to draft, so the builder accepts it again."
            : ""}
        </DialogDescription>
      </DialogHeader>
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
          <Field label="Code" htmlFor="wo-code" helper="Optional, e.g. SI-004. Default WO-0001…">
            <Input id="wo-code" value={draft.code} onChange={(e) => set("code", e.target.value)} />
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
          <Field label="Representative's email" htmlFor="wo-rep-email">
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
      </FieldGroup>
      <DialogFooter className="flex-wrap items-center gap-3">
        {reason && <p className="mr-auto text-xs text-muted-foreground">{reason}</p>}
        <Button type="submit" disabled={reason !== null || save.isPending}>
          {save.isPending ? "Saving…" : editing ? "Save changes" : "Create draft"}
        </Button>
      </DialogFooter>
    </form>
  );
}
