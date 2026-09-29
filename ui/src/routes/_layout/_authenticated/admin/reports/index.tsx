import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
  FieldGroup,
  Input,
} from "@/components";
import { ReportPreview, reportOverviewCsvValues } from "@/components/admin/report-preview";
import { AdminError } from "@/components/admin-error";
import { ChoiceSelect, Field } from "@/components/admin-form";
import { PageHeader } from "@/components/page-header";
import { ReportNoteField } from "@/components/report-note-field";
import { SavedReportsList } from "@/components/saved-reports";
import { useApiClient } from "@/lib/api";
import { type CsvColumn, csvTimestamp, downloadCsv } from "@/lib/csv";
import {
  adminProjectsListQueryOptions,
  adminSavedReportQueryOptions,
  adminSavedReportsQueryOptions,
  engagementsListQueryOptions,
  refreshAfter,
} from "@/lib/queries";
import { formatAllocatedSpent, formatTokenTotals } from "@/lib/report-amounts";

export const Route = createFileRoute("/_layout/_authenticated/admin/reports/")({
  validateSearch: z.object({ report: z.string().optional().catch(undefined) }),
  head: () => ({
    meta: [{ title: "Reports | Admin" }],
  }),
  component: AdminReportsPage,
});

function AdminReportsPage() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { report: reportId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const savedQuery = useQuery(adminSavedReportsQueryOptions(apiClient));
  const openedQuery = useQuery({
    ...adminSavedReportQueryOptions(apiClient, reportId ?? ""),
    enabled: !!reportId,
  });
  const report = reportId ? (openedQuery.data?.report ?? null) : null;
  const engagementsQuery = useQuery(engagementsListQueryOptions(apiClient));
  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));
  const [engagementId, setEngagementId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [note, setNote] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const engagements = (engagementsQuery.data?.data ?? []).filter(
    (e) => e.side === "agency" && (e.status === "active" || e.status === "ended"),
  );
  const clientNameOf = (id: string | null) =>
    id ? (engagements.find((e) => e.id === id)?.client.name ?? null) : "all clients";
  const openReport = (id: string) => {
    void navigate({ search: { report: id } });
  };
  const projects = projectsQuery.data?.data ?? [];

  const projectOptions = useMemo(() => {
    if (!engagementId) return projects;
    const engagement = engagements.find((e) => e.id === engagementId);
    const allowed = new Set(engagement?.projectIds ?? []);
    return projects.filter((p) => allowed.has(p.id));
  }, [engagementId, engagements, projects]);

  const generateMutation = useMutation({
    mutationFn: () =>
      apiClient.agency.reports.generate({
        engagementId: engagementId || undefined,
        projectId: projectId || undefined,
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
    const overviewRows = [
      { section: "Overview", label: "Projects", value: String(report.overview.projectCount) },
      { section: "Overview", label: "Total budget", value: overview.budget },
      { section: "Overview", label: "Total billed", value: overview.billed },
      { section: "Overview", label: "Period", value: report.overview.period },
    ];
    const contributorRows = report.contributorStats.map((s) => ({
      section: "Contributor",
      label: s.name,
      value: `${formatTokenTotals(s.billedByToken)} (${s.billingCount} billings)`,
    }));
    const clientRows = report.clientBreakdown.map((r) => ({
      section: "Client project",
      label: `${r.clientName} / ${r.projectTitle}`,
      value: formatAllocatedSpent(r.budgetByToken, r.spentByToken),
    }));
    const rows = [...overviewRows, ...contributorRows, ...clientRows];
    if (report.notes) {
      rows.push({ section: "Notes", label: "Notes", value: report.notes });
    }
    const columns: CsvColumn<(typeof rows)[number]>[] = [
      { header: "Section", value: (r) => r.section },
      { header: "Label", value: (r) => r.label },
      { header: "Value", value: (r) => r.value },
    ];
    downloadCsv(`report-${csvTimestamp()}.csv`, rows, columns);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description="Per-token budget, spend and builder totals for clients and internal review. Every generated report is saved with its memo."
      />

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Generate a report</h2>
          </CardTitle>
          <CardDescription>
            Leave the filters empty to cover every client and project.
          </CardDescription>
        </CardHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!generateMutation.isPending) generateMutation.mutate();
          }}
        >
          <CardContent>
            <FieldGroup>
              <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
                <Field label="Client" htmlFor="report-client">
                  <ChoiceSelect
                    id="report-client"
                    value={engagementId}
                    onValueChange={(value) => {
                      setEngagementId(value);
                      setProjectId("");
                    }}
                    emptyLabel="All clients"
                    options={engagements.map((e) => ({ value: e.id, label: e.client.name }))}
                  />
                </Field>
                <Field label="Project" htmlFor="report-project">
                  <ChoiceSelect
                    id="report-project"
                    value={projectId}
                    onValueChange={setProjectId}
                    emptyLabel="All projects"
                    options={projectOptions.map((p) => ({ value: p.id, label: p.title }))}
                  />
                </Field>
                <Field label="Start date" htmlFor="report-start">
                  <Input
                    id="report-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </Field>
                <Field label="End date" htmlFor="report-end">
                  <Input
                    id="report-end"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </Field>
              </div>
              <ReportNoteField id="report-note" value={note} onChange={setNote} />
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={generateMutation.isPending}>
              {generateMutation.isPending ? "Generating…" : "Generate report"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Saved reports</h2>
          </CardTitle>
          <CardDescription>Open a saved report to preview it and download its CSV.</CardDescription>
        </CardHeader>
        <CardContent>
          {savedQuery.isError ? (
            <AdminError error={savedQuery.error} />
          ) : (
            <SavedReportsList
              reports={savedQuery.data?.data ?? []}
              selectedId={reportId}
              onOpen={openReport}
              describe={(r) => clientNameOf(r.engagementId)}
            />
          )}
        </CardContent>
      </Card>

      {openedQuery.isError && <AdminError error={openedQuery.error} />}
      {report && (
        <ReportPreview
          report={report}
          actions={
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <DownloadSimpleIcon data-icon="inline-start" aria-hidden />
              Summary CSV
            </Button>
          }
        />
      )}
    </div>
  );
}
