import { useQuery } from "@tanstack/react-query";
import {
  Empty,
  EmptyTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import { type ApiClient, useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";

type Rollup = Awaited<ReturnType<ApiClient["treasury"]["getRollups"]>>["rollups"][number];

export function TreasuryRollups() {
  const apiClient = useApiClient();
  const rollupsQuery = useQuery({
    queryKey: ["treasury", "rollups"],
    queryFn: () => apiClient.treasury.getRollups(),
    staleTime: 30_000,
    retry: false,
  });

  if (rollupsQuery.isLoading) {
    return (
      <div className="border border-border">
        <Table>
          <RollupsTableHeader />
          <TableBody>
            {[0, 1].map((i) => (
              <RollupRowSkeleton key={i} />
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }
  if (rollupsQuery.isError) {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        could not load — try again
      </p>
    );
  }
  const rollups = rollupsQuery.data?.rollups ?? [];
  if (rollups.length === 0) {
    return (
      <Empty className="border-2 border-dashed border-border/40">
        <EmptyTitle className="font-mono text-sm font-normal text-muted-foreground">
          No activity yet. Budget funds, attach NEARN listings, or record billings to see the
          rollup.
        </EmptyTitle>
      </Empty>
    );
  }
  return (
    <div className="border border-border">
      <Table>
        <RollupsTableHeader />
        <TableBody>
          {rollups.map((r) => (
            <RollupRow key={r.tokenId} rollup={r} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RollupsTableHeader() {
  const cols = ["balance", "budgeted", "allocated", "committed", "paid", "remaining", "available"];
  return (
    <TableHeader>
      <TableRow>
        <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em]">token</TableHead>
        {cols.map((c) => (
          <TableHead
            key={c}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-right"
          >
            {c}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

function RollupRow({ rollup }: { rollup: Rollup }) {
  const isNeg = (s: string) => s.trim().startsWith("-");
  return (
    <TableRow>
      <TableCell className="font-mono text-xs break-all">{rollup.tokenId}</TableCell>
      <TableCell className="font-mono tabular-nums text-right whitespace-nowrap">
        {formatTokenAmount(rollup.balance, rollup.tokenId)}
      </TableCell>
      <TableCell className="font-mono tabular-nums text-right whitespace-nowrap">
        {formatTokenAmount(rollup.budgeted, rollup.tokenId)}
      </TableCell>
      <TableCell className="font-mono tabular-nums text-right whitespace-nowrap">
        {formatTokenAmount(rollup.allocated, rollup.tokenId)}
      </TableCell>
      <TableCell className="font-mono tabular-nums text-right whitespace-nowrap">
        {formatTokenAmount(rollup.committed, rollup.tokenId)}
      </TableCell>
      <TableCell className="font-mono tabular-nums text-right whitespace-nowrap">
        {formatTokenAmount(rollup.paid, rollup.tokenId)}
      </TableCell>
      <TableCell
        className={`font-mono tabular-nums text-right whitespace-nowrap ${
          isNeg(rollup.remaining) ? "text-destructive" : ""
        }`}
      >
        {formatTokenAmount(rollup.remaining, rollup.tokenId)}
      </TableCell>
      <TableCell
        className={`font-mono tabular-nums text-right whitespace-nowrap ${
          isNeg(rollup.available) ? "text-destructive" : ""
        }`}
      >
        {formatTokenAmount(rollup.available, rollup.tokenId)}
      </TableCell>
    </TableRow>
  );
}

function RollupRowSkeleton() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="h-3 w-20" />
      </TableCell>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <TableCell key={i} className="text-right">
          <Skeleton className="h-3 w-20 ml-auto" />
        </TableCell>
      ))}
    </TableRow>
  );
}
