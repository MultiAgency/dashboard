import { useState } from "react";
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import { Empty } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { ApiClient } from "@/lib/api";

export type SavedReportSummary = Awaited<
  ReturnType<ApiClient["agency"]["reports"]["list"]>
>["data"][number];

export function reportPeriod(report: { startDate: string | null; endDate: string | null }) {
  if (report.startDate && report.endDate) return `${report.startDate} – ${report.endDate}`;
  if (report.startDate) return `from ${report.startDate}`;
  if (report.endDate) return `through ${report.endDate}`;
  return "All time";
}

function createdAt(report: SavedReportSummary): string {
  return new Date(report.createdAt).toISOString().slice(0, 16).replace("T", " ");
}

export function SavedReportsList({
  reports,
  selectedId,
  onOpen,
  titleOf,
  agencyName,
  onToggleShare,
  onDelete,
}: {
  reports: SavedReportSummary[];
  selectedId: string | undefined;
  onOpen: (id: string) => void;
  titleOf: (report: SavedReportSummary) => string;
  agencyName?: string;
  onToggleShare?: (report: SavedReportSummary, share: boolean) => Promise<unknown>;
  onDelete?: (report: SavedReportSummary) => Promise<unknown>;
}) {
  const [deleting, setDeleting] = useState<SavedReportSummary | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  if (reports.length === 0) return <Empty label="No saved reports yet." />;

  const toggleShare = async (report: SavedReportSummary) => {
    if (!onToggleShare) return;
    setSharingId(report.id);
    try {
      await onToggleShare(report, !report.sharedAt);
    } finally {
      setSharingId(null);
    }
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Report</TableHead>
            <TableHead scope="col">Saved</TableHead>
            <TableHead scope="col">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.map((report) => (
            <TableRow
              key={report.id}
              data-state={report.id === selectedId ? "selected" : undefined}
            >
              <TableCell className="whitespace-normal">
                <div className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {titleOf(report)}
                    {report.fromAgency ? (
                      <Badge variant="secondary">From {agencyName ?? "your agency"}</Badge>
                    ) : report.sharedAt ? (
                      <Badge variant="outline">Shared</Badge>
                    ) : null}
                  </span>
                  {report.note && (
                    <span className="text-sm text-muted-foreground line-clamp-2">
                      {report.note}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {createdAt(report)}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    size="sm"
                    variant={report.id === selectedId ? "default" : "outline"}
                    onClick={() => onOpen(report.id)}
                  >
                    {report.id === selectedId ? "Open" : "View"}
                  </Button>
                  {onToggleShare && report.canShare && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={sharingId === report.id}
                      onClick={() => void toggleShare(report)}
                    >
                      {report.sharedAt ? "Unshare" : "Share with client"}
                    </Button>
                  )}
                  {onDelete && report.canDelete && (
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(report)}>
                      Delete
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete this report?"
        description={
          deleting
            ? `${titleOf(deleting)}. ${
                deleting.sharedAt ? "It is shared with the client, so they lose it too. " : ""
              }This can't be undone.`
            : undefined
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={async () => {
          if (deleting && onDelete) await onDelete(deleting);
        }}
      />
    </>
  );
}
