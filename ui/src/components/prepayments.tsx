import { ReceiptIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
} from "@/components";
import { AdminError } from "@/components/admin-error";
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
import { formatTokenAmount } from "@/lib/format-amount";
import { prepaidBalanceQueryOptions, prepaymentsListQueryOptions } from "@/lib/queries";
import { tokenDisplayName } from "@/lib/report-amounts";
import { safeHttpHref } from "@/lib/url";

export type PrepaymentView = Awaited<ReturnType<ApiClient["prepayments"]["list"]>>["data"][number];

export function PrepaidBalanceCard({ engagementId }: { engagementId: string }) {
  const apiClient = useApiClient();
  const balanceQuery = useQuery(prepaidBalanceQueryOptions(apiClient, engagementId));
  const rows = balanceQuery.data?.data ?? [];

  if (balanceQuery.isError) return <AdminError error={balanceQuery.error} />;

  return (
    <Card>
      <CardHeader>
        <CardDescription>Prepaid balance</CardDescription>
        {balanceQuery.isLoading ? (
          <Skeleton className="h-8 w-32" />
        ) : rows.length === 0 ? (
          <div className="font-heading text-2xl font-semibold text-muted-foreground">—</div>
        ) : rows.length === 1 ? (
          <div className="font-heading text-2xl font-semibold tabular-nums">
            {formatTokenAmount(rows[0].balance, rows[0].tokenId)}
          </div>
        ) : null}
      </CardHeader>
      {rows.length > 0 && (
        <CardContent>
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.tokenId} className="flex flex-col gap-0.5">
                {rows.length > 1 && (
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-muted-foreground">{tokenDisplayName(row.tokenId)}</span>
                    <span className="text-sm font-medium tabular-nums">
                      {formatTokenAmount(row.balance, row.tokenId)}
                    </span>
                  </div>
                )}
                <span className="text-muted-foreground tabular-nums">
                  {formatTokenAmount(row.prepaid, row.tokenId)} prepaid,{" "}
                  {formatTokenAmount(row.budgeted, row.tokenId)} in budgets
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
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
      rel="noopener noreferrer"
      className="break-all underline underline-offset-4 hover:text-foreground"
    >
      {reference}
    </a>
  ) : (
    <span className="break-all">{reference}</span>
  );
}

export function PrepaymentTable({
  engagementId,
  actions,
  description = "Every Prepayment recorded on this Engagement, newest first.",
}: {
  engagementId: string;
  actions?: (prepayment: PrepaymentView) => ReactNode;
  description?: string;
}) {
  const apiClient = useApiClient();
  const listQuery = useQuery(prepaymentsListQueryOptions(apiClient, engagementId));

  if (listQuery.isError) return <AdminError error={listQuery.error} />;
  const prepayments = listQuery.data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prepayments</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {listQuery.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : prepayments.length === 0 ? (
          <Empty variant="outline">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ReceiptIcon aria-hidden />
              </EmptyMedia>
              <EmptyTitle>No Prepayments yet</EmptyTitle>
              <EmptyDescription>Recorded Prepayments show up here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Transfer</TableHead>
                <TableHead>Recorded</TableHead>
                {actions && (
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {prepayments.map((prepayment) => (
                <TableRow key={prepayment.id}>
                  <TableCell>{prepayment.period}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatTokenAmount(prepayment.amount, prepayment.tokenId)}
                  </TableCell>
                  <TableCell className="max-w-64 whitespace-normal">
                    <TransferReference reference={prepayment.transferReference} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(prepayment.createdAt).toISOString().slice(0, 10)}
                  </TableCell>
                  {actions && <TableCell className="text-right">{actions(prepayment)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
