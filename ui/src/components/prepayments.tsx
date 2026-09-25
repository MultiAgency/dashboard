import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty } from "@/components/admin-form";
import { TokenAmountCell } from "@/components/token-amounts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import { prepaidBalanceQueryOptions, prepaymentsListQueryOptions } from "@/lib/queries";
import { tokenDisplayName } from "@/lib/report-amounts";
import { safeHttpHref } from "@/lib/url";

export type PrepaymentView = Awaited<ReturnType<ApiClient["prepayments"]["list"]>>["data"][number];

export function PrepaidBalanceCard({ engagementId }: { engagementId: string }) {
  const apiClient = useApiClient();
  const balanceQuery = useQuery(prepaidBalanceQueryOptions(apiClient, engagementId));
  const rows = balanceQuery.data?.data ?? [];

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="text-xs uppercase text-muted-foreground">Prepaid balance</div>
        {balanceQuery.isError ? (
          <AdminError error={balanceQuery.error} />
        ) : rows.length === 0 ? (
          <div className="font-display text-2xl font-black">—</div>
        ) : (
          <ul className="space-y-1">
            {rows.map((row) => (
              <li key={row.tokenId} className="text-sm space-y-0.5">
                <div>
                  <span className="text-muted-foreground mr-1">
                    {tokenDisplayName(row.tokenId)}:
                  </span>
                  <TokenAmountCell amount={row.balance} tokenId={row.tokenId} />
                </div>
                <div className="text-xs text-muted-foreground">
                  prepaid <TokenAmountCell amount={row.prepaid} tokenId={row.tokenId} /> · in
                  budgets <TokenAmountCell amount={row.budgeted} tokenId={row.tokenId} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TransferReference({ reference }: { reference: string | null }) {
  if (!reference) return <span className="text-muted-foreground">—</span>;
  const href = safeHttpHref(reference);
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-xs underline break-all hover:text-foreground"
    >
      {reference}
    </a>
  ) : (
    <span className="font-mono text-xs break-all">{reference}</span>
  );
}

export function PrepaymentTable({
  engagementId,
  actions,
}: {
  engagementId: string;
  actions?: (prepayment: PrepaymentView) => ReactNode;
}) {
  const apiClient = useApiClient();
  const listQuery = useQuery(prepaymentsListQueryOptions(apiClient, engagementId));

  if (listQuery.isError) return <AdminError error={listQuery.error} />;
  const prepayments = listQuery.data?.data ?? [];
  if (listQuery.isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (prepayments.length === 0) return <Empty label="No Prepayments recorded yet." />;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>period</TableHead>
          <TableHead>amount</TableHead>
          <TableHead>transfer</TableHead>
          <TableHead>recorded</TableHead>
          {actions && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {prepayments.map((prepayment) => (
          <TableRow key={prepayment.id}>
            <TableCell className="font-mono text-xs">{prepayment.period}</TableCell>
            <TableCell>
              <TokenAmountCell amount={prepayment.amount} tokenId={prepayment.tokenId} />
            </TableCell>
            <TableCell className="max-w-64">
              <TransferReference reference={prepayment.transferReference} />
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {new Date(prepayment.createdAt).toISOString().slice(0, 10)}
            </TableCell>
            {actions && <TableCell className="text-right">{actions(prepayment)}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
