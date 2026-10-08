import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  Button,
  Card,
  CardAction,
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
import {
  reportPeriod,
  type SavedReportSummary,
  SavedReportsList,
} from "@/components/saved-reports";
import { useMeRoles } from "@/hooks/use-me-roles";
import { type ApiClient, useApiClient } from "@/lib/api";
import { type CsvColumn, csvTimestamp, downloadCsv } from "@/lib/csv";
import {
  adminProjectsListQueryOptions,
  adminSavedReportQueryOptions,
  adminSavedReportsQueryOptions,
  engagementsListQueryOptions,
  refreshAfter,
} from "@/lib/queries";
import { formatAllocatedSpent, formatTokenTotals } from "@/lib/report-amounts";
import { MONTH_PRESETS } from "@/lib/report-dates";

export const Route = createFileRoute("/_layout/_authenticated/admin/reports/")({
  validateSearch: z.object({ report: z.string().optional().catch(undefined) }),
  head: () => ({
    meta: [{ title: "Reports | Admin" }],
  }),
  component: AdminReportsPage,
});

type ReportFilters = {
  engagementId?: string;
  projectId?: string;
  note?: string;
  startDate?: string;
  endDate?: string;
};

type ShownReport = Awaited<ReturnType<ApiClient["agency"]["reports"]["preview"]>>;

function summaryCsv(report: ShownReport) {
  const overview = reportOverviewCsvValues(report.overview);
  const rows = [
    { section: "Overview", label: "Projects", value: String(report.overview.projectCount) },
    { section: "Overview", label: "Total budget", value: overview.budget },
    { section: "Overview", label: "Total billed", value: overview.billed },
    { section: "Overview", label: "Period", value: report.overview.period },
    ...(report.projectBreakdown ?? []).map((p) => ({
      section: "Project",
      label: p.projectTitle,
      value: `budget: ${formatTokenTotals(p.budgetByToken)}, billed: ${formatTokenTotals(p.billedByToken)}`,
    })),
    ...report.contributorStats.map((s) => ({
      section: "Contributor",
      label: s.name,
      value: `${formatTokenTotals(s.billedByToken)} (${s.billingCount} billings)`,
    })),
    ...report.clientBreakdown.map((r) => ({
      section: "Client project",
      label: `${r.clientName} / ${r.projectTitle}`,
      value: formatAllocatedSpent(r.budgetByToken, r.spentByToken),
    })),
  ];
  if (report.notes) rows.push({ section: "Notes", label: "Notes", value: report.notes });
  const columns: CsvColumn<(typeof rows)[number]>[] = [
    { header: "Section", value: (r) => r.section },
    { header: "Label", value: (r) => r.label },
    { header: "Value", value: (r) => r.value },
  ];
  downloadCsv(`report-${csvTimestamp()}.csv`, rows, columns);
}

function AdminReportsPage() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { canAccessAdmin } = useMeRoles();
  const { report: reportId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const savedQuery = useQuery(adminSavedReportsQueryOptions(apiClient));
  const openedQuery = useQuery({
    ...adminSavedReportQueryOptions(apiClient, reportId ?? ""),
    enabled: !!reportId,
  });
  const engagementsQuery = useQuery(engagementsListQueryOptions(apiClient));
  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));
  const [engagementId, setEngagementId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [note, setNote] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [historyClient, setHistoryClient] = useState("");
  const [preview, setPreview] = useState<{ filters: ReportFilters; report: ShownReport } | null>(
    null,
  );

  const engagements = (engagementsQuery.data?.data ?? []).filter(
    (e) => e.side === "agency" && (e.status === "active" || e.status === "ended"),
  );
  const clientNameOf = (id: string | null) =>
    id ? (engagements.find((e) => e.id === id)?.client.name ?? "Client") : "All clients";
  const openReport = (id: string | undefined) => {
    void navigate({ search: id ? { report: id } : {} });
  };
  const projects = projectsQuery.data?.data ?? [];

  const projectOptions = useMemo(() => {
    if (!engagementId) return projects;
    const engagement = engagements.find((e) => e.id === engagementId);
    const allowed = new Set(engagement?.projectIds ?? []);
    return projects.filter((p) => allowed.has(p.id));
  }, [engagementId, engagements, projects]);

  const refreshReports = () => refreshAfter(queryClient, { type: "reports" });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const filters: ReportFilters = {
        engagementId: engagementId || undefined,
        projectId: projectId || undefined,
        note: note.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };
      return { filters, report: await apiClient.agency.reports.preview(filters) };
    },
    onSuccess: (result) => {
      setPreview(result);
      openReport(undefined);
    },
    onError: (err: Error) => toast.error(err.message || "Failed to generate report"),
  });

  const saveMutation = useMutation({
    mutationFn: (share: boolean) => {
      if (!preview) throw new Error("Generate a report first");
      return apiClient.agency.reports.generate({ ...preview.filters, share });
    },
    onSuccess: async (data, share) => {
      await refreshReports();
      setPreview(null);
      openReport(data.id);
      toast.success(share ? "Report saved and shared with the client" : "Report saved");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save report"),
  });

  const toggleShare = async (report: SavedReportSummary, share: boolean) => {
    try {
      await (share
        ? apiClient.agency.reports.share({ id: report.id })
        : apiClient.agency.reports.unshare({ id: report.id }));
      await refreshReports();
      toast.success(
        share ? `Shared with ${clientNameOf(report.engagementId)}` : "No longer shared",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update sharing");
    }
  };

  const deleteReport = async (report: SavedReportSummary) => {
    try {
      await apiClient.agency.reports.delete({ id: report.id });
      if (report.id === reportId) openReport(undefined);
      await refreshReports();
      toast.success("Report deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete report");
    }
  };

  const saved = (savedQuery.data?.data ?? []).filter(
    (r) => !historyClient || r.engagementId === historyClient,
  );
  const previewEngagement = preview?.filters.engagementId
    ? engagements.find((e) => e.id === preview.filters.engagementId)
    : undefined;
  const canShareSelection = canAccessAdmin && previewEngagement?.kind === "client";
  const shown: ShownReport | null =
    preview?.report ?? (reportId ? (openedQuery.data?.report ?? null) : null);
  const titleOf = (r: SavedReportSummary) =>
    [clientNameOf(r.engagementId), r.projectTitle, reportPeriod(r)].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description="Per-token budget, spend and builder totals for clients and internal review. Preview a report, then save it or share it with the client."
      />

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Generate a report</h2>
          </CardTitle>
          <CardDescription>
            Leave the filters empty to cover every client and project.
          </CardDescription>
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
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!previewMutation.isPending) previewMutation.mutate();
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
            <Button type="submit" disabled={previewMutation.isPending}>
              {previewMutation.isPending ? "Generating…" : "Generate preview"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {openedQuery.isError && !preview && <AdminError error={openedQuery.error} />}
      {shown && (
        <ReportPreview
          report={shown}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => summaryCsv(shown)}>
                <DownloadSimpleIcon data-icon="inline-start" aria-hidden />
                Summary CSV
              </Button>
              {preview && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={saveMutation.isPending}
                    onClick={() => setPreview(null)}
                  >
                    Discard
                  </Button>
                  {canShareSelection && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={saveMutation.isPending}
                      onClick={() => saveMutation.mutate(true)}
                    >
                      Save & share with {previewEngagement?.client.name}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={saveMutation.isPending}
                    onClick={() => saveMutation.mutate(false)}
                  >
                    {saveMutation.isPending ? "Saving…" : "Save"}
                  </Button>
                </>
              )}
            </div>
          }
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Saved reports</h2>
          </CardTitle>
          <CardDescription>
            Open a saved report, share it with the client it covers, or delete it.
          </CardDescription>
          {engagements.length > 0 && (
            <CardAction>
              <ChoiceSelect
                id="report-history-client"
                value={historyClient}
                onValueChange={setHistoryClient}
                emptyLabel="All reports"
                options={engagements.map((e) => ({ value: e.id, label: e.client.name }))}
              />
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {savedQuery.isError ? (
            <AdminError error={savedQuery.error} />
          ) : (
            <SavedReportsList
              reports={saved}
              selectedId={preview ? undefined : reportId}
              onOpen={(id) => {
                setPreview(null);
                openReport(id);
              }}
              titleOf={titleOf}
              onToggleShare={toggleShare}
              onDelete={deleteReport}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
