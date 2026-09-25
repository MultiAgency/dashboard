import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  SectionHeader,
  Skeleton,
  Spinner,
} from "@/components";
import { ReportPreview, reportOverviewCsvValues } from "@/components/admin/report-preview";
import { AdminError } from "@/components/admin-error";
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
    <div className="flex flex-col gap-6">
      <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
        Generate a report of the Projects {engagement.agency.name} shares with you, with their
        budget and billings. Reports are saved with their memo, so everyone on your team can open
        them later.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Generate a report</CardTitle>
          <CardDescription>Leave the dates empty to cover the whole Engagement.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <ReportNoteField id="client-report-note" value={note} onChange={setNote} />
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="client-report-start">Start date (optional)</FieldLabel>
                <Input
                  id="client-report-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="client-report-end">End date (optional)</FieldLabel>
                <Input
                  id="client-report-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex-wrap justify-end gap-2">
          {report && (
            <Button variant="outline" onClick={handleDownload}>
              <DownloadSimpleIcon data-icon="inline-start" aria-hidden />
              Download summary CSV
            </Button>
          )}
          <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
            {generateMutation.isPending && <Spinner data-icon="inline-start" />}
            Generate report
          </Button>
        </CardFooter>
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="client-saved-reports">
        <SectionHeader id="client-saved-reports" title="Saved reports" />
        {savedQuery.isLoading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <span className="sr-only">Loading saved reports</span>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : savedQuery.isError ? (
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
