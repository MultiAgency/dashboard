import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useState } from "react";
import { Button, Skeleton } from "@/components";
import { downloadCsv, csvTimestamp, type CsvColumn } from "@/lib/csv";

export type { ColumnDef };

export type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  emptyMessage?: string;
  csvFilename?: string;
};

const TH_CLS =
  "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground px-3 py-2 text-left border-b border-border";
const TD_CLS = "px-3 py-2 text-sm border-b border-border";
const SORT_BTN_CLS =
  "inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer";

function SortHeader({ column, label }: { column: { id: string; getIsSorted: () => string | false; getToggleSortingHandler: () => ((event: unknown) => void) | undefined }; label: string }) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className={SORT_BTN_CLS}
      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
    >
      {label}
      {sorted === "asc" ? <ArrowDown className="size-3" /> : sorted === "desc" ? <ArrowUp className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
    </button>
  );
}

export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading,
  error,
  onRetry,
  emptyMessage = "No data",
  csvFilename,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (error) {
    return (
      <div data-slot="data-table" className="space-y-3">
        <div className="rounded-sm border border-destructive/60 px-4 py-3 text-sm text-destructive">
          {error.message || "Failed to load data"}
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            retry
          </Button>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div data-slot="data-table" className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div data-slot="data-table" className="rounded-sm border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  const exportColumns: CsvColumn<TData>[] = columns
    .filter((c) => "header" in c && typeof (c as { header?: string }).header === "string")
    .map((c) => {
      const col = c as { id?: string; header?: string; accessorKey?: string };
      return {
        header: col.header ?? col.id ?? "",
        value: (row: TData) => {
          const key = col.accessorKey as keyof TData;
          return key ? String(row[key] ?? "") : "";
        },
      };
    });

  return (
    <div data-slot="data-table" className="space-y-3">
      {csvFilename && exportColumns.length > 0 && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadCsv(
              `${csvFilename}-${csvTimestamp()}.csv`,
              data,
              exportColumns,
            )}
          >
            export csv
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const label = flexRender(header.column.columnDef.header, header.getContext());
                  const isSortable = header.column.getCanSort();
                  return (
                    <th key={header.id} scope="col" className={TH_CLS}>
                      {isSortable ? (
                        <SortHeader
                          column={{ id: header.column.id, getIsSorted: () => header.column.getIsSorted(), getToggleSortingHandler: header.column.getToggleSortingHandler }}
                          label={label as string}
                        />
                      ) : (
                        label
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className={TD_CLS}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
