import { Button } from "@/components";
import { Empty } from "@/components/admin-form";
import type { ApiClient } from "@/lib/api";

export type SavedReportSummary = Awaited<
  ReturnType<ApiClient["agency"]["reports"]["list"]>
>["data"][number];

function dateRange(report: SavedReportSummary): string {
  if (report.startDate && report.endDate) return `${report.startDate} – ${report.endDate}`;
  if (report.startDate) return `from ${report.startDate}`;
  if (report.endDate) return `through ${report.endDate}`;
  return "all time";
}

export function SavedReportsList({
  reports,
  selectedId,
  onOpen,
  describe,
}: {
  reports: SavedReportSummary[];
  selectedId: string | undefined;
  onOpen: (id: string) => void;
  describe?: (report: SavedReportSummary) => string | null;
}) {
  if (reports.length === 0) return <Empty label="No saved reports yet." />;
  return (
    <ul className="space-y-2">
      {reports.map((report) => {
        const scope = describe?.(report);
        return (
          <li
            key={report.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border p-3"
          >
            <div className="min-w-0 space-y-1">
              <div className="font-mono text-xs">
                {new Date(report.createdAt).toISOString().slice(0, 16).replace("T", " ")} ·{" "}
                {dateRange(report)}
                {scope ? ` · ${scope}` : ""}
              </div>
              {report.note && (
                <p className="text-sm text-muted-foreground line-clamp-2">{report.note}</p>
              )}
            </div>
            <Button
              size="sm"
              variant={report.id === selectedId ? "default" : "outline"}
              onClick={() => onOpen(report.id)}
            >
              {report.id === selectedId ? "open" : "view"}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
