import { type ReactNode, useMemo } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
} from "@/components";
import { ClientBreakdownSection } from "@/components/admin/client-breakdown-section";
import { StatCard } from "@/components/budget";
import { TokenAmountCell } from "@/components/token-amounts";
import type { ColumnDef } from "@/components/ui/data-table";
import {
  type DeliveredWork,
  DeliveredWorkSection,
} from "@/components/work-orders/delivered-work-section";
import { formatTokenAmount } from "@/lib/format-amount";
import {
  collectReportTokenIds,
  formatTokenTotals,
  getTokenAmount,
  type TokenAmount,
  tokenDisplayName,
} from "@/lib/report-amounts";
import { trezuProposalUrl } from "@/lib/trezu";

export type ReportViewData = {
  overview: {
    projectCount: number;
    budgetByToken: TokenAmount[];
    billedByToken: TokenAmount[];
    unattributedByToken?: TokenAmount[];
    pendingByToken?: TokenAmount[];
    payoutSync?: "complete" | "partial" | "unavailable";
    period: string;
  };
  projectBreakdown?: Array<{
    projectTitle: string;
    projectSlug: string;
    budgetByToken: TokenAmount[];
    billedByToken: TokenAmount[];
    builders?: string[];
  }>;
  contributorStats: Array<{
    nearAccount: string;
    name: string;
    billedByToken: TokenAmount[];
    billingCount: number;
  }>;
  clientBreakdown: Array<{
    clientName: string;
    projectTitle: string;
    projectSlug: string;
    budgetByToken: TokenAmount[];
    spentByToken: TokenAmount[];
    builders?: string[];
  }>;
  agreement?: {
    title: string;
    kind: "retainer" | "project";
    startDate: string;
    endDate: string;
    tokenId: string;
    agreedAmount: string;
    allocated: string;
  } | null;
  deliveredWork?: DeliveredWork[];
  payouts?: ReportPayout[];
  notes?: string;
};

export type ReportPayout = {
  paidAt: string;
  daoAccountId: string;
  proposalId: string;
  nearAccount: string;
  builderName: string;
  tokenId: string;
  amount: string;
  note: string | null;
  projectTitle: string | null;
  projectSlug: string | null;
  attribution: "billing" | "assignment" | "shared" | "unassigned";
  sharedWith: string[];
  status?: "paid" | "pending";
};

function isAgentPayout(payout: Pick<ReportPayout, "proposalId">): boolean {
  return payout.proposalId.startsWith("intents:");
}

function payoutProjectLabel(payout: ReportPayout): string {
  if (payout.projectTitle) return payout.projectTitle;
  if (payout.attribution === "shared") return `Several: ${payout.sharedWith.join(", ")}`;
  return "No project";
}

const basePayoutColumns: ColumnDef<ReportPayout>[] = [
  {
    id: "date",
    header: "Requested",
    accessorKey: "paidAt",
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span className="whitespace-nowrap tabular-nums">{row.original.paidAt.slice(0, 10)}</span>
        {isAgentPayout(row.original) ? (
          <span className="whitespace-nowrap text-muted-foreground">Agent payout</span>
        ) : row.original.daoAccountId ? (
          <a
            className="whitespace-nowrap text-muted-foreground underline underline-offset-4"
            href={trezuProposalUrl(row.original.daoAccountId, row.original.proposalId)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Proposal #{row.original.proposalId}
          </a>
        ) : (
          <span className="text-muted-foreground">Proposal #{row.original.proposalId}</span>
        )}
      </div>
    ),
    meta: {
      exportValue: (row: ReportPayout) =>
        `${row.paidAt.slice(0, 10)} ${isAgentPayout(row) ? "agent payout" : `#${row.proposalId}`}`,
    },
  },
  {
    id: "builder",
    header: "Paid to",
    accessorKey: "builderName",
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{row.original.builderName}</span>
        {row.original.builderName !== row.original.nearAccount && (
          <span
            className="max-w-48 truncate text-muted-foreground"
            title={row.original.nearAccount}
          >
            {row.original.nearAccount}
          </span>
        )}
      </div>
    ),
    meta: {
      exportValue: (row: ReportPayout) => `${row.builderName} (${row.nearAccount})`,
    },
  },
  {
    id: "project",
    header: "Project",
    accessorFn: payoutProjectLabel,
    cell: ({ row }) => (
      <span
        className={
          row.original.projectTitle
            ? "block max-w-64 whitespace-normal"
            : "block max-w-64 whitespace-normal text-muted-foreground"
        }
      >
        {payoutProjectLabel(row.original)}
      </span>
    ),
    meta: { exportValue: payoutProjectLabel },
  },
  {
    id: "amount",
    header: "Amount",
    accessorKey: "amount",
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <TokenAmountCell amount={row.original.amount} tokenId={row.original.tokenId} />
        {row.original.status === "pending" && (
          <span className="whitespace-nowrap text-muted-foreground">Awaiting approval</span>
        )}
      </div>
    ),
    meta: {
      exportValue: (row: ReportPayout) =>
        `${formatTokenAmount(row.amount, row.tokenId)}${row.status === "pending" ? " (awaiting approval)" : ""}`,
    },
  },
  {
    id: "note",
    header: "Note",
    accessorFn: (row) => row.note ?? "",
    cell: ({ row }) => (
      <span className="block max-w-80 whitespace-normal text-muted-foreground">
        {row.original.note ?? "—"}
      </span>
    ),
    meta: { exportValue: (row: ReportPayout) => row.note ?? "" },
  },
];

type TokenSummaryRow = {
  tokenId: string;
  tokenLabel: string;
  budget?: string;
  billed?: string;
  unattributed?: string;
  pending?: string;
};

type ProjectBudgetRow = TokenSummaryRow & {
  projectTitle: string;
  projectSlug: string;
  builders: string;
};

type BuilderRow = {
  nearAccount: string;
  name: string;
  billingCount: number;
  amounts: TokenAmount[];
};

function buildTokenSummaryRows(
  budget: TokenAmount[],
  billed: TokenAmount[],
  unattributed: TokenAmount[] = [],
  pending: TokenAmount[] = [],
): TokenSummaryRow[] {
  return collectReportTokenIds(budget, billed, unattributed, pending).map((tokenId) => ({
    tokenId,
    tokenLabel: tokenDisplayName(tokenId),
    budget: getTokenAmount(budget, tokenId),
    billed: getTokenAmount(billed, tokenId),
    unattributed: getTokenAmount(unattributed, tokenId),
    pending: getTokenAmount(pending, tokenId),
  }));
}

const tokenSummaryColumns: ColumnDef<TokenSummaryRow>[] = [
  {
    id: "token",
    header: "Token",
    accessorKey: "tokenLabel",
    cell: ({ row }) => (
      <span className="font-medium" title={row.original.tokenId}>
        {row.original.tokenLabel}
      </span>
    ),
  },
  {
    id: "budget",
    header: "Budget",
    accessorFn: (row) => row.budget ?? "",
    cell: ({ row }) => (
      <TokenAmountCell amount={row.original.budget} tokenId={row.original.tokenId} />
    ),
    meta: {
      exportValue: (row: TokenSummaryRow) =>
        row.budget ? formatTokenAmount(row.budget, row.tokenId) : "—",
    },
  },
  {
    id: "billed",
    header: "Paid",
    accessorFn: (row) => row.billed ?? "",
    cell: ({ row }) => (
      <TokenAmountCell amount={row.original.billed} tokenId={row.original.tokenId} />
    ),
    meta: {
      exportValue: (row: TokenSummaryRow) =>
        row.billed ? formatTokenAmount(row.billed, row.tokenId) : "—",
    },
  },
];

const unattributedColumn: ColumnDef<TokenSummaryRow> = {
  id: "unattributed",
  header: "Paid, no single project",
  accessorFn: (row) => row.unattributed ?? "",
  cell: ({ row }) => (
    <TokenAmountCell amount={row.original.unattributed} tokenId={row.original.tokenId} />
  ),
  meta: {
    exportValue: (row: TokenSummaryRow) =>
      row.unattributed ? formatTokenAmount(row.unattributed, row.tokenId) : "—",
  },
};

const pendingColumn: ColumnDef<TokenSummaryRow> = {
  id: "pending",
  header: "Awaiting approval",
  accessorFn: (row) => row.pending ?? "",
  cell: ({ row }) => (
    <TokenAmountCell amount={row.original.pending} tokenId={row.original.tokenId} />
  ),
  meta: {
    exportValue: (row: TokenSummaryRow) =>
      row.pending ? formatTokenAmount(row.pending, row.tokenId) : "—",
  },
};

function buildProjectBudgetRows(
  breakdown: NonNullable<ReportViewData["projectBreakdown"]>,
  clientBreakdown: ReportViewData["clientBreakdown"],
): ProjectBudgetRow[] {
  return breakdown.flatMap((project) => {
    const builders =
      project.builders ??
      clientBreakdown.find((c) => c.projectSlug === project.projectSlug)?.builders ??
      [];
    const rows = buildTokenSummaryRows(project.budgetByToken, project.billedByToken);
    const lines: TokenSummaryRow[] = rows.length > 0 ? rows : [{ tokenId: "", tokenLabel: "—" }];
    return lines.map((row) => ({
      ...row,
      projectTitle: project.projectTitle,
      projectSlug: project.projectSlug,
      builders: builders.join(", "),
    }));
  });
}

const projectBudgetColumns: ColumnDef<ProjectBudgetRow>[] = [
  {
    id: "project",
    header: "Project",
    accessorKey: "projectTitle",
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{row.original.projectTitle}</span>
        <span className="text-muted-foreground">@{row.original.projectSlug}</span>
      </div>
    ),
    meta: {
      exportValue: (row: ProjectBudgetRow) => row.projectTitle,
    },
  },
  {
    id: "builders",
    header: "Builders",
    accessorKey: "builders",
    cell: ({ row }) => (
      <span className="block max-w-80 whitespace-normal text-muted-foreground">
        {row.original.builders || "—"}
      </span>
    ),
    meta: {
      exportValue: (row: ProjectBudgetRow) => row.builders || "—",
    },
  },
  ...(tokenSummaryColumns as ColumnDef<ProjectBudgetRow>[]),
];

function useBuilderColumns(tokenIds: string[]): ColumnDef<BuilderRow>[] {
  return useMemo(() => {
    const base: ColumnDef<BuilderRow>[] = [
      {
        id: "name",
        header: "Builder",
        accessorKey: "name",
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-muted-foreground">{row.original.nearAccount}</span>
          </div>
        ),
        meta: {
          exportValue: (row: BuilderRow) => `${row.name} (${row.nearAccount})`,
        },
      },
      {
        id: "billings",
        header: "Payouts",
        accessorKey: "billingCount",
        cell: ({ row }) => row.original.billingCount,
      },
    ];

    for (const tokenId of tokenIds) {
      const label = tokenDisplayName(tokenId);
      base.push({
        id: `token-${tokenId}`,
        header: label,
        accessorFn: (row) => getTokenAmount(row.amounts, tokenId) ?? "",
        cell: ({ row }) => (
          <TokenAmountCell
            amount={getTokenAmount(row.original.amounts, tokenId)}
            tokenId={tokenId}
          />
        ),
        meta: {
          exportValue: (row: BuilderRow) => {
            const amt = getTokenAmount(row.amounts, tokenId);
            return amt ? formatTokenAmount(amt, tokenId) : "—";
          },
        },
      });
    }

    return base;
  }, [tokenIds]);
}

type ReportPreviewProps = {
  report: ReportViewData;
  showBuilders?: boolean;
  actions?: ReactNode;
  payoutAction?: (payout: ReportPayout) => ReactNode;
};

export function ReportPreview({
  report,
  showBuilders = true,
  actions,
  payoutAction,
}: ReportPreviewProps) {
  const unattributed = report.overview.unattributedByToken ?? [];
  const tokenSummary = useMemo(
    () =>
      buildTokenSummaryRows(
        report.overview.budgetByToken,
        report.overview.billedByToken,
        report.overview.unattributedByToken,
        report.overview.pendingByToken,
      ),
    [
      report.overview.budgetByToken,
      report.overview.billedByToken,
      report.overview.unattributedByToken,
      report.overview.pendingByToken,
    ],
  );
  const hasUnattributed = unattributed.some((t) => BigInt(t.amount) !== 0n);
  const hasPending = (report.overview.pendingByToken ?? []).some((t) => BigInt(t.amount) !== 0n);
  const summaryColumns = useMemo(
    () => [
      ...tokenSummaryColumns,
      ...(hasUnattributed ? [unattributedColumn] : []),
      ...(hasPending ? [pendingColumn] : []),
    ],
    [hasUnattributed, hasPending],
  );

  const projectBudgetRows = useMemo(
    () => buildProjectBudgetRows(report.projectBreakdown ?? [], report.clientBreakdown),
    [report.projectBreakdown, report.clientBreakdown],
  );
  const multiToken = new Set(projectBudgetRows.map((r) => r.tokenId).filter(Boolean)).size > 1;
  const projectColumns = useMemo(
    () =>
      multiToken ? projectBudgetColumns : projectBudgetColumns.filter((c) => c.id !== "token"),
    [multiToken],
  );
  const clientCount = new Set(report.clientBreakdown.map((c) => c.clientName)).size;
  const showClientBreakdown = clientCount > 1 || !report.projectBreakdown;
  const payouts = report.payouts ?? [];
  const hasNotes = payouts.some((p) => p.note);
  const payoutColumns = useMemo<ColumnDef<ReportPayout>[]>(() => {
    const visible = hasNotes ? basePayoutColumns : basePayoutColumns.filter((c) => c.id !== "note");
    return payoutAction
      ? [
          ...visible,
          {
            id: "action",
            header: "",
            enableSorting: false,
            cell: ({ row }) => (
              <div className="w-40 print:hidden">{payoutAction(row.original)}</div>
            ),
            meta: { exportValue: () => "" },
          },
        ]
      : visible;
  }, [payoutAction, hasNotes]);

  const builderTokenIds = useMemo(
    () => collectReportTokenIds(...report.contributorStats.map((s) => s.billedByToken)),
    [report.contributorStats],
  );

  const builderRows: BuilderRow[] = useMemo(
    () =>
      report.contributorStats.map((s) => ({
        nearAccount: s.nearAccount,
        name: s.name,
        billingCount: s.billingCount,
        amounts: s.billedByToken,
      })),
    [report.contributorStats],
  );

  const builderColumns = useBuilderColumns(builderTokenIds);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Report overview</h2>
          </CardTitle>
          <CardDescription>
            Budget set for the period and what the treasury paid out in it.
          </CardDescription>
          {actions && <CardAction>{actions}</CardAction>}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Projects" value={report.overview.projectCount} />
            <div className="sm:col-span-2">
              <StatCard label="Period" value={report.overview.period} />
            </div>
            {report.agreement && (
              <>
                <div className="sm:col-span-2">
                  <StatCard
                    label={report.agreement.kind === "retainer" ? "Retainer" : "Project agreement"}
                    value={report.agreement.title}
                  />
                </div>
                <StatCard
                  label="Allocated of agreed"
                  value={`${formatTokenAmount(report.agreement.allocated, report.agreement.tokenId)} of ${formatTokenAmount(report.agreement.agreedAmount, report.agreement.tokenId)}`}
                />
              </>
            )}
          </div>
          <DataTable
            columns={summaryColumns}
            data={tokenSummary}
            emptyMessage="No budget or payouts"
            csvFilename="report-token-summary"
            viewId="report-token-summary"
            enableSearch={false}
          />
          {report.overview.payoutSync === "partial" && (
            <p className="text-sm text-warning">
              The DAO's payout history is still loading, so Paid may be too low. Generate the report
              again in a moment before saving or sharing it.
            </p>
          )}
          {report.overview.payoutSync === "unavailable" && (
            <p className="text-sm text-warning">
              Couldn't reach the DAO, so payouts made since it was last checked may be missing.
            </p>
          )}
          {hasUnattributed && (
            <p className="text-sm text-muted-foreground">
              Paid, no single project: payouts to someone on several projects or on none, so they
              aren't counted toward any one project.
              {payouts.length > 0 && " Each is listed under Payouts."}
            </p>
          )}
        </CardContent>
      </Card>

      {projectBudgetRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Projects</h2>
            </CardTitle>
            <CardDescription>
              Who works on each project, its budget for the period and what it was paid.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={projectColumns}
              data={projectBudgetRows}
              emptyMessage="No projects in this period"
              csvFilename="report-projects"
              viewId="report-projects"
              searchPlaceholder="Filter projects…"
            />
          </CardContent>
        </Card>
      )}

      {showClientBreakdown && report.clientBreakdown.length > 0 && (
        <ClientBreakdownSection breakdown={report.clientBreakdown} />
      )}

      {report.deliveredWork && report.deliveredWork.length > 0 && (
        <DeliveredWorkSection items={report.deliveredWork} />
      )}

      {payouts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Payouts</h2>
            </CardTitle>
            <CardDescription>
              Every approved treasury transfer in the period, and the project it counts toward.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={payoutColumns}
              data={payouts}
              emptyMessage="No payouts"
              csvFilename="report-payouts"
              viewId="report-payouts"
              searchPlaceholder="Filter payouts…"
            />
          </CardContent>
        </Card>
      )}

      {showBuilders && report.contributorStats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Builders</h2>
            </CardTitle>
            <CardDescription>Paid per builder and token in the period.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={builderColumns}
              data={builderRows}
              emptyMessage="No builder payouts"
              csvFilename="report-builders"
              viewId="report-builders"
              enableSearch={false}
            />
          </CardContent>
        </Card>
      )}

      {report.notes && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Report memo</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{report.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function reportOverviewCsvValues(report: ReportViewData["overview"]) {
  return {
    budget: formatTokenTotals(report.budgetByToken),
    billed: formatTokenTotals(report.billedByToken),
  };
}
