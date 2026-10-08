import { DownloadSimpleIcon, FilePdfIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardAction,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
} from "@/components";
import { ReportPreview, reportOverviewCsvValues } from "@/components/admin/report-preview";
import { AdminError } from "@/components/admin-error";
import type { EngagementView } from "@/components/engagement-status";
import { ReportNoteField } from "@/components/report-note-field";
import {
  reportPeriod,
  type SavedReportSummary,
  SavedReportsList,
} from "@/components/saved-reports";
import { type ApiClient, useApiClient } from "@/lib/api";
import { type CsvColumn, csvTimestamp, downloadCsv } from "@/lib/csv";
import {
  clientPortalProjectsListQueryOptions,
  clientSavedReportQueryOptions,
  clientSavedReportsQueryOptions,
  refreshAfter,
} from "@/lib/queries";
import { formatAllocatedSpent } from "@/lib/report-amounts";
import { MONTH_PRESETS } from "@/lib/report-dates";

const ALL_PROJECTS = "all";

type ClientReportFilters = Parameters<ApiClient["clientPortal"]["reports"]["preview"]>[0];
type PreviewReport = Awaited<ReturnType<ApiClient["clientPortal"]["reports"]["preview"]>>;

export function ClientReports({
  engagement,
  reportId,
  onOpenReport,
  initialProjectId,
}: {
  engagement: EngagementView;
  reportId: string | undefined;
  onOpenReport: (id: string | undefined) => void;
  initialProjectId?: string;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const savedQuery = useQuery(clientSavedReportsQueryOptions(apiClient, engagement.id));
  const openedQuery = useQuery({
    ...clientSavedReportQueryOptions(apiClient, engagement.id, reportId ?? ""),
    enabled: !!reportId,
  });
  const [preview, setPreview] = useState<{
    filters: Omit<ClientReportFilters, "engagementId">;
    report: PreviewReport;
  } | null>(null);
  const report: PreviewReport | null =
    preview?.report ?? (reportId ? (openedQuery.data?.report ?? null) : null);
  const projects =
    useQuery(clientPortalProjectsListQueryOptions(apiClient, engagement.id)).data?.data ?? [];
  const [pickedProjectId, setProjectId] = useState(initialProjectId ?? ALL_PROJECTS);
  const projectId = projects.some((p) => p.id === pickedProjectId) ? pickedProjectId : ALL_PROJECTS;
  const [note, setNote] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const openReport = onOpenReport;

  const previewMutation = useMutation({
    mutationFn: async () => {
      const filters = {
        projectId: projectId === ALL_PROJECTS ? undefined : projectId,
        note: note.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };
      return {
        filters,
        report: await apiClient.clientPortal.reports.preview({
          engagementId: engagement.id,
          ...filters,
        }),
      };
    },
    onSuccess: (result) => setPreview(result),
    onError: (err: Error) => toast.error(err.message || "Failed to generate report"),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error("Generate a report first");
      return apiClient.clientPortal.reports.generate({
        engagementId: engagement.id,
        ...preview.filters,
      });
    },
    onSuccess: async (data) => {
      await refreshAfter(queryClient, { type: "reports" });
      setPreview(null);
      openReport(data.id);
      toast.success("Report saved");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save report"),
  });

  const deleteReport = async (saved: SavedReportSummary) => {
    try {
      await apiClient.clientPortal.reports.delete({ engagementId: engagement.id, id: saved.id });
      if (saved.id === reportId) openReport(undefined);
      await refreshAfter(queryClient, { type: "reports" });
      toast.success("Report deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete report");
    }
  };

  const handleDownload = () => {
    if (!report) return;
    const overview = reportOverviewCsvValues(report.overview);
    const rows = [
      ...report.clientBreakdown.flatMap((r) => [
        {
          section: "Project",
          label: r.projectTitle,
          value: formatAllocatedSpent(r.budgetByToken, r.spentByToken),
        },
        ...(r.builders && r.builders.length > 0
          ? [{ section: "Builders", label: r.projectTitle, value: r.builders.join(", ") }]
          : []),
      ]),
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
      <p className="max-w-2xl text-sm text-pretty text-muted-foreground print:hidden">
        Generate a report of the Projects {engagement.agency.name} shares with you, with their
        budget and billings. Save a report to keep it with its memo, so everyone on your team can
        open it later. Reports {engagement.agency.name} shares with you show up here too.
      </p>
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Generate a report</CardTitle>
          <CardDescription>Leave the dates empty to cover the whole Engagement.</CardDescription>
          <CardAction className="flex flex-wrap gap-2">
            {MONTH_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                size="sm"
                variant="outline"
                onClick={() => {
                  const range = preset.range(new Date());
                  setStartDate(range.start);
                  setEndDate(range.end);
                }}
              >
                {preset.label}
              </Button>
            ))}
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="client-report-project">Project</FieldLabel>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="client-report-project" className="w-full sm:w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_PROJECTS}>All shared projects</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
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
            <>
              <Button variant="outline" onClick={() => window.print()}>
                <FilePdfIcon data-icon="inline-start" aria-hidden />
                Download PDF
              </Button>
              <Button variant="outline" onClick={handleDownload}>
                <DownloadSimpleIcon data-icon="inline-start" aria-hidden />
                Download summary CSV
              </Button>
            </>
          )}
          {preview && (
            <>
              <Button
                variant="outline"
                onClick={() => setPreview(null)}
                disabled={saveMutation.isPending}
              >
                Discard
              </Button>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Spinner data-icon="inline-start" />}
                Save report
              </Button>
            </>
          )}
          <Button
            variant={preview ? "outline" : "default"}
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending}
          >
            {previewMutation.isPending && <Spinner data-icon="inline-start" />}
            Generate preview
          </Button>
        </CardFooter>
      </Card>

      {openedQuery.isError && !preview && <AdminError error={openedQuery.error} />}
      {report && <ReportPreview report={report} showBuilders={false} />}

      <section className="flex flex-col gap-3 print:hidden" aria-labelledby="client-saved-reports">
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
            selectedId={preview ? undefined : reportId}
            onOpen={(id) => {
              setPreview(null);
              openReport(id);
            }}
            titleOf={(r) => `${r.projectTitle ?? "All shared projects"} · ${reportPeriod(r)}`}
            agencyName={engagement.agency.name}
            onDelete={deleteReport}
          />
        )}
      </section>
    </div>
  );
}
