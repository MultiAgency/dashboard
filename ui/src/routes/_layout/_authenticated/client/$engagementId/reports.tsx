import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button, Card, CardContent } from "@/components";
import { ReportPreview, reportOverviewCsvValues } from "@/components/admin/report-preview";
import { AdminError } from "@/components/admin-error";
import { Field, selectClass } from "@/components/admin-form";
import { ReportNoteField } from "@/components/report-note-field";
import { SavedReportsList } from "@/components/saved-reports";
import { useApiClient } from "@/lib/api";
import { type CsvColumn, csvTimestamp, downloadCsv } from "@/lib/csv";
import {
  clientSavedReportQueryOptions,
  clientSavedReportsQueryOptions,
  refreshAfter,
} from "@/lib/queries";
import { formatAllocatedSpent } from "@/lib/report-amounts";

export const Route = createFileRoute("/_layout/_authenticated/client/$engagementId/reports")({
  validateSearch: z.object({ report: z.string().optional().catch(undefined) }),
  component: ClientReportsPage,
});

function ClientReportsPage() {
  const { engagement } = Route.useRouteContext();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { report: reportId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const savedQuery = useQuery(clientSavedReportsQueryOptions(apiClient, engagement.id));
  const openedQuery = useQuery({
    ...clientSavedReportQueryOptions(apiClient, engagement.id, reportId ?? ""),
    enabled: !!reportId,
  });
  const report = reportId ? (openedQuery.data?.report ?? null) : null;
  const [note, setNote] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const openReport = (id: string) => {
    void navigate({ search: { report: id } });
  };

  const generateMutation = useMutation({
    mutationFn: () =>
      apiClient.clientPortal.reports.generate({
        engagementId: engagement.id,
        note: note.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      }),
    onSuccess: async (data) => {
      await refreshAfter(queryClient, { type: "reports" });
      openReport(data.id);
      toast.success("Report generated and saved");
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
        Generate a report of the Projects {engagement.agency.name} shares with you, with their
        budget and billings. Reports are saved with their memo, so everyone on your team can open
        them later.
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

      <section className="space-y-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          saved reports
        </h2>
        {savedQuery.isError ? (
          <AdminError error={savedQuery.error} />
        ) : (
          <SavedReportsList
            reports={savedQuery.data?.data ?? []}
            selectedId={reportId}
            onOpen={openReport}
          />
        )}
      </section>

      {openedQuery.isError && <AdminError error={openedQuery.error} />}
      {report && <ReportPreview report={report} showBuilders={false} />}
    </div>
  );
}
