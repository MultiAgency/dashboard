import type { ColumnDef } from "@tanstack/react-table";
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
  showBuilders?: boolean;
  actions?: ReactNode;
};

export function ReportPreview({ report, showBuilders = true, actions }: ReportPreviewProps) {
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
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Report overview</h2>
          </CardTitle>
          <CardDescription>Budget and billed totals per token for the period.</CardDescription>
          {actions && <CardAction>{actions}</CardAction>}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Projects" value={report.overview.projectCount} />
            <div className="sm:col-span-2">
              <StatCard label="Period" value={report.overview.period} />
            </div>
          </div>
          <DataTable
            columns={tokenSummaryColumns}
            data={tokenSummary}
            emptyMessage="No budget or billing amounts"
            csvFilename="report-token-summary"
            viewId="report-token-summary"
            enableSearch={false}
          />
        </CardContent>
      </Card>

      {report.clientBreakdown.length > 0 && (
        <ClientBreakdownSection breakdown={report.clientBreakdown} />
      )}

      {showBuilders && report.contributorStats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Builders</h2>
            </CardTitle>
            <CardDescription>Billed amounts per builder and token.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={builderColumns}
              data={builderRows}
              emptyMessage="No builder billings"
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
