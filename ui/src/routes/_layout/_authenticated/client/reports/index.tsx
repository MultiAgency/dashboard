import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardContent } from "@/components";
import { ReportPreview, reportOverviewCsvValues } from "@/components/admin/report-preview";
import { Field, selectClass } from "@/components/admin-form";
import { ReportNoteField } from "@/components/report-note-field";
import { useApiClient } from "@/lib/api";
import { type CsvColumn, csvTimestamp, downloadCsv } from "@/lib/csv";
import { formatAllocatedSpent } from "@/lib/report-amounts";

export const Route = createFileRoute("/_layout/_authenticated/client/reports/")({
  component: ClientReportsPage,
});

function ClientReportsPage() {
  const { agencyDaoAccountId } = Route.useRouteContext();
  const apiClient = useApiClient();
  const [note, setNote] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [report, setReport] = useState<Awaited<
    ReturnType<typeof apiClient.clientPortal.reports.generate>
  > | null>(null);

  const generateMutation = useMutation({
    mutationFn: () =>
      apiClient.clientPortal.reports.generate({
        agencyDaoAccountId,
        note: note.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      }),
    onSuccess: (data) => {
      setReport(data);
      toast.success("Report generated");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to generate report"),
  });

  const handleDownload = () => {
    if (!report) return;
    const overview = reportOverviewCsvValues(report.overview);
    const rows = [
      ...report.clientBreakdown.map((r) => ({
        section: "Project",
        label: r.projectTitle,
        value: formatAllocatedSpent(r.budgetByToken, r.spentByToken),
      })),
      {
        section: "Overview",
        label: "Total billed",
        value: overview.billed,
      },
    ];
    if (report.notes) rows.push({ section: "Notes", label: "Notes", value: report.notes });
    const columns: CsvColumn<(typeof rows)[number]>[] = [
      { header: "Section", value: (r) => r.section },
      { header: "Label", value: (r) => r.label },
      { header: "Value", value: (r) => r.value },
    ];
    downloadCsv(`client-report-${csvTimestamp()}.csv`, rows, columns);
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Generate a tabular report scoped to your projects and billings.
      </p>
      <Card>
        <CardContent className="p-5 grid gap-4">
          <ReportNoteField id="client-report-note" value={note} onChange={setNote} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="start date (optional)" htmlFor="client-report-start">
              <input
                id="client-report-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={selectClass}
              />
            </Field>
            <Field label="end date (optional)" htmlFor="client-report-end">
              <input
                id="client-report-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={selectClass}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
              {generateMutation.isPending ? "generating..." : "generate report"}
            </Button>
            {report && (
              <Button variant="outline" onClick={handleDownload}>
                download summary csv
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {report && <ReportPreview report={report} showBuilders={false} />}
    </div>
  );
}
