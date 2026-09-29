import {
  ArrowDownIcon,
  ArrowsDownUpIcon,
  ArrowUpIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ColumnsIcon,
  DownloadSimpleIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  TableIcon,
} from "@phosphor-icons/react";
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
import { useEffect, useState } from "react";
import { LoadError } from "@/components/load-error";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  /** Hide CSV export and column picker when tables are read-only. */
  readOnly?: boolean;
};

type ExportMeta<TData> = {
  exportValue?: (row: TData) => string;
};

function columnExportValue<TData>(col: ColumnDef<TData, unknown>, row: TData): string {
  const meta = col.meta as ExportMeta<TData> | undefined;
  if (meta?.exportValue) return meta.exportValue(row);

  const def = col as {
    accessorFn?: (row: TData, index: number) => unknown;
    accessorKey?: keyof TData & string;
  };

  if (typeof def.accessorFn === "function") {
    const value = def.accessorFn(row, 0);
    return value == null ? "" : String(value);
  }

  if (def.accessorKey) {
    const value = row[def.accessorKey];
    return value == null ? "" : String(value);
  }

  return "";
}

type SortDirection = string | false;

function ariaSort(sorted: SortDirection) {
  return sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none";
}

function SortHeader({
  sorted,
  onToggle,
  label,
}: {
  sorted: SortDirection;
  onToggle: ((event: unknown) => void) | undefined;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onToggle}
      className="-ml-2 text-muted-foreground hover:text-foreground"
    >
      {label}
      {sorted === "asc" ? (
        <ArrowDownIcon data-icon="inline-end" aria-hidden />
      ) : sorted === "desc" ? (
        <ArrowUpIcon data-icon="inline-end" aria-hidden />
      ) : (
        <ArrowsDownUpIcon data-icon="inline-end" aria-hidden className="opacity-50" />
      )}
    </Button>
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
  readOnly = false,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() =>
    loadVisibility(viewId),
  );

  useEffect(() => {
    if (!viewId || typeof window === "undefined") return;
    try {
      localStorage.setItem(`datatable-cols-${viewId}`, JSON.stringify(columnVisibility));
    } catch {}
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
      <div data-slot="data-table">
        <LoadError
          title="Could not load this list"
          description={error.message || "Check your connection and try again."}
          onRetry={onRetry}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div data-slot="data-table" className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64 max-w-full" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const exportColumns: CsvColumn<TData>[] = columns
    .filter((c) => "header" in c && typeof (c as { header?: string }).header === "string")
    .map((c) => {
      const col = c as ColumnDef<TData, unknown>;
      return {
        header: (typeof col.header === "string" ? col.header : col.id) ?? "",
        value: (row: TData) => columnExportValue(col, row),
      };
    });

  const exportRows = table.getFilteredRowModel().rows.map((row) => row.original);

  const rows = table.getRowModel().rows;
  const filteredEmpty = data.length > 0 && rows.length === 0;
  const hideableColumns = table.getAllColumns().filter((c) => {
    if (!c.getCanHide()) return false;
    const header = c.columnDef.header;
    return !(typeof header === "string" && header.trim() === "");
  });
  const showColumns = !readOnly && hideableColumns.length > 0;
  const showExport = !readOnly && !!csvFilename && exportColumns.length > 0;
  const showToolbar = enableSearch || showColumns || showExport;
  const pageCount = table.getPageCount() || 1;
  const showPagination =
    pageCount > 1 || table.getPrePaginationRowModel().rows.length > (pageSizeOptions[0] ?? 10);

  return (
    <div data-slot="data-table" className="flex min-w-0 flex-col gap-3">
      {showToolbar && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {enableSearch ? (
            <InputGroup className="w-full sm:w-64">
              <InputGroupAddon>
                <MagnifyingGlassIcon aria-hidden />
              </InputGroupAddon>
              <InputGroupInput
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
            </InputGroup>
          ) : (
            <span />
          )}
          {(showColumns || showExport) && (
            <div className="flex items-center gap-2">
              {showColumns && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      <ColumnsIcon data-icon="inline-start" aria-hidden />
                      Columns
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {hideableColumns.map((column) => (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        checked={column.getIsVisible()}
                        onCheckedChange={(value) => column.toggleVisibility(!!value)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {typeof column.columnDef.header === "string"
                          ? column.columnDef.header
                          : column.id}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {showExport && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    downloadCsv(`${csvFilename}-${csvTimestamp()}.csv`, exportRows, exportColumns)
                  }
                >
                  <DownloadSimpleIcon data-icon="inline-start" aria-hidden />
                  Export CSV
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {data.length === 0 || filteredEmpty ? (
        <Empty variant="outline">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {filteredEmpty ? <FunnelIcon aria-hidden /> : <TableIcon aria-hidden />}
            </EmptyMedia>
            <EmptyTitle>{filteredEmpty ? "No matching rows" : emptyMessage}</EmptyTitle>
            {filteredEmpty && (
              <EmptyDescription>Try a different search or clear the filter.</EmptyDescription>
            )}
          </EmptyHeader>
          {filteredEmpty ? (
            <EmptyContent>
              <Button type="button" variant="outline" size="sm" onClick={() => setGlobalFilter("")}>
                Clear filter
              </Button>
            </EmptyContent>
          ) : (
            emptyAction && <EmptyContent>{emptyAction}</EmptyContent>
          )}
        </Empty>
      ) : (
        <>
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header) => {
                    const label = flexRender(header.column.columnDef.header, header.getContext());
                    const isSortable = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    return (
                      <TableHead
                        key={header.id}
                        scope="col"
                        className="text-muted-foreground"
                        aria-sort={isSortable ? ariaSort(sorted) : undefined}
                      >
                        {isSortable ? (
                          <SortHeader
                            sorted={sorted}
                            onToggle={header.column.getToggleSortingHandler()}
                            label={label as string}
                          />
                        ) : (
                          label
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {showPagination && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  Page {table.getState().pagination.pageIndex + 1} of {pageCount}
                </span>
                <Select
                  value={String(table.getState().pagination.pageSize)}
                  onValueChange={(value) => table.setPageSize(Number(value))}
                >
                  <SelectTrigger size="sm" aria-label="Rows per page">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pageSizeOptions.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} / page
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                >
                  <CaretLeftIcon data-icon="inline-start" aria-hidden />
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                >
                  Next
                  <CaretRightIcon data-icon="inline-end" aria-hidden />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
