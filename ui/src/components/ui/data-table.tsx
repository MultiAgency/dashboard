import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Input, Skeleton } from "@/components";
import { type CsvColumn, csvTimestamp, downloadCsv } from "@/lib/csv";

export type { ColumnDef };

export type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
  csvFilename?: string;
  viewId?: string;
  pageSizeOptions?: number[];
  enableSearch?: boolean;
  searchPlaceholder?: string;
};

const TH_CLS =
  "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground px-3 py-2 text-left border-b border-border";
const TD_CLS = "px-3 py-2 text-sm border-b border-border";
const SORT_BTN_CLS =
  "inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer";

function SortHeader({
  column,
  label,
}: {
  column: {
    id: string;
    getIsSorted: () => string | false;
    getToggleSortingHandler: () => ((event: unknown) => void) | undefined;
  };
  label: string;
}) {
  const sorted = column.getIsSorted();
  return (
    <th
      scope="col"
      onClick={column.getToggleSortingHandler()}
      className={SORT_BTN_CLS}
      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
    >
      {label}
      {sorted === "asc" ? (
        <ArrowDown className="size-3" />
      ) : sorted === "desc" ? (
        <ArrowUp className="size-3" />
      ) : (
        <ArrowUpDown className="size-3 opacity-40" />
      )}
    </th>
  );
}

function loadVisibility(viewId: string | undefined): VisibilityState {
  if (!viewId || typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(`datatable-cols-${viewId}`);
    return raw ? (JSON.parse(raw) as VisibilityState) : {};
  } catch {
    return {};
  }
}

export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading,
  error,
  onRetry,
  emptyMessage = "No data",
  emptyAction,
  csvFilename,
  viewId,
  pageSizeOptions = [10, 25, 50],
  enableSearch = true,
  searchPlaceholder = "Filter…",
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() =>
    loadVisibility(viewId),
  );
  const [colsOpen, setColsOpen] = useState(false);

  useEffect(() => {
    if (!viewId || typeof window === "undefined") return;
    localStorage.setItem(`datatable-cols-${viewId}`, JSON.stringify(columnVisibility));
  }, [columnVisibility, viewId]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: pageSizeOptions[0] ?? 10 },
    },
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
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
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

  const rows = table.getRowModel().rows;
  const filteredEmpty = data.length > 0 && rows.length === 0;

  return (
    <div data-slot="data-table" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {enableSearch && (
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-7 h-8 w-48 sm:w-64"
              />
            </div>
          )}
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setColsOpen((v) => !v)}
              className="gap-1.5"
            >
              <Columns3 className="size-3.5" />
              columns
            </Button>
            {colsOpen && (
              <div className="absolute z-20 mt-1 w-48 rounded-sm border border-border bg-background p-2 shadow-md space-y-1">
                {table
                  .getAllColumns()
                  .filter((c) => {
                    if (!c.getCanHide()) return false;
                    const header = c.columnDef.header;
                    if (typeof header === "string" && header.trim() === "") return false;
                    return true;
                  })
                  .map((column) => (
                    <label
                      key={column.id}
                      className="flex items-center gap-2 px-1 py-1 text-xs font-mono cursor-pointer hover:bg-muted/40 rounded-sm"
                    >
                      <input
                        type="checkbox"
                        checked={column.getIsVisible()}
                        onChange={column.getToggleVisibilityHandler()}
                        className="accent-foreground"
                      />
                      {typeof column.columnDef.header === "string"
                        ? column.columnDef.header
                        : column.id}
                    </label>
                  ))}
              </div>
            )}
          </div>
        </div>
        {csvFilename && exportColumns.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadCsv(`${csvFilename}-${csvTimestamp()}.csv`, data, exportColumns)}
          >
            export csv
          </Button>
        )}
      </div>

      {data.length === 0 || filteredEmpty ? (
        <div className="rounded-sm border border-dashed border-border px-4 py-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            {filteredEmpty ? "No rows match the current filter." : emptyMessage}
          </p>
          {!filteredEmpty && emptyAction}
        </div>
      ) : (
        <>
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
                              column={{
                                id: header.column.id,
                                getIsSorted: () => header.column.getIsSorted(),
                                getToggleSortingHandler: header.column.getToggleSortingHandler,
                              }}
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
                {rows.map((row) => (
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

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
              <span>
                page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
              </span>
              <select
                value={table.getState().pagination.pageSize}
                onChange={(e) => table.setPageSize(Number(e.target.value))}
                className="h-7 border border-input bg-background px-2 rounded-sm"
              >
                {pageSizeOptions.map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
