import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { DataTable } from "@/components";
import { ClientBreakdownSection } from "@/components/admin/client-breakdown-section";
import { TokenAmountCell } from "@/components/token-amounts";
import { formatTokenAmount } from "@/lib/format-amount";
import {
  collectReportTokenIds,
  formatTokenTotals,
  getTokenAmount,
  type TokenAmount,
  tokenDisplayName,
} from "@/lib/report-amounts";

export type ReportViewData = {
  overview: {
    projectCount: number;
    budgetByToken: TokenAmount[];
    billedByToken: TokenAmount[];
    period: string;
  };
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
  }>;
  notes?: string;
};

type TokenSummaryRow = {
  tokenId: string;
  tokenLabel: string;
  budget?: string;
  billed?: string;
};

type BuilderRow = {
  nearAccount: string;
  name: string;
  billingCount: number;
  amounts: TokenAmount[];
};

const SECTION_TITLE = "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground";

function buildTokenSummaryRows(budget: TokenAmount[], billed: TokenAmount[]): TokenSummaryRow[] {
  return collectReportTokenIds(budget, billed).map((tokenId) => ({
    tokenId,
    tokenLabel: tokenDisplayName(tokenId),
    budget: getTokenAmount(budget, tokenId),
    billed: getTokenAmount(billed, tokenId),
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
    header: "Billed",
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

function useBuilderColumns(tokenIds: string[]): ColumnDef<BuilderRow>[] {
  return useMemo(() => {
    const base: ColumnDef<BuilderRow>[] = [
      {
        id: "name",
        header: "Builder",
        accessorKey: "name",
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name}</div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {row.original.nearAccount}
            </div>
          </div>
        ),
        meta: {
          exportValue: (row: BuilderRow) => `${row.name} (${row.nearAccount})`,
        },
      },
      {
        id: "billings",
        header: "Billings",
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
  /** Hide builder section (client portal). */
  showBuilders?: boolean;
};

export function ReportPreview({ report, showBuilders = true }: ReportPreviewProps) {
  const tokenSummary = useMemo(
    () => buildTokenSummaryRows(report.overview.budgetByToken, report.overview.billedByToken),
    [report.overview.budgetByToken, report.overview.billedByToken],
  );

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
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className={SECTION_TITLE}>overview</h2>
        <dl className="grid gap-3 sm:grid-cols-3 text-sm mb-2">
          <div className="rounded-sm border border-border px-3 py-2">
            <dt className="text-xs text-muted-foreground">Projects</dt>
            <dd className="font-display text-2xl font-black">{report.overview.projectCount}</dd>
          </div>
          <div className="rounded-sm border border-border px-3 py-2 sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Period</dt>
            <dd className="font-mono">{report.overview.period}</dd>
          </div>
        </dl>
        <DataTable
          columns={tokenSummaryColumns}
          data={tokenSummary}
          emptyMessage="No budget or billing amounts."
          csvFilename="report-token-summary"
          viewId="report-token-summary"
          enableSearch={false}
        />
      </section>

      {report.clientBreakdown.length > 0 && (
        <ClientBreakdownSection breakdown={report.clientBreakdown} />
      )}

      {showBuilders && report.contributorStats.length > 0 && (
        <section className="space-y-3">
          <h2 className={SECTION_TITLE}>builders</h2>
          <DataTable
            columns={builderColumns}
            data={builderRows}
            emptyMessage="No builder billings."
            csvFilename="report-builders"
            viewId="report-builders"
            enableSearch={false}
          />
        </section>
      )}

      {report.notes && (
        <section className="rounded-sm border border-border p-4 space-y-2">
          <h2 className={SECTION_TITLE}>report memo</h2>
          <p className="text-sm whitespace-pre-wrap">{report.notes}</p>
        </section>
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
