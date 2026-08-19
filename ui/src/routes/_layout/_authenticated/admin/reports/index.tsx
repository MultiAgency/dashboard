import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardContent } from "@/components";
import { ReportPreview, reportOverviewCsvValues } from "@/components/admin/report-preview";
import { Field, selectClass } from "@/components/admin-form";
import { ReportNoteField } from "@/components/report-note-field";
import { useApiClient } from "@/lib/api";
import { type CsvColumn, csvTimestamp, downloadCsv } from "@/lib/csv";
import { adminClientsListQueryOptions, adminProjectsListQueryOptions } from "@/lib/queries";
import { formatAllocatedSpent, formatTokenTotals } from "@/lib/report-amounts";

export const Route = createFileRoute("/_layout/_authenticated/admin/reports/")({
  head: () => ({
    meta: [{ title: "Reports | Admin" }],
  }),
  component: AdminReportsPage,
});

function AdminReportsPage() {
  const apiClient = useApiClient();
  const clientsQuery = useQuery(adminClientsListQueryOptions(apiClient));
  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [note, setNote] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [report, setReport] = useState<Awaited<
    ReturnType<typeof apiClient.agency.reports.generate>
  > | null>(null);

  const clients = clientsQuery.data?.data ?? [];
  const projects = projectsQuery.data?.data ?? [];

  const projectOptions = useMemo(() => {
    if (!clientId) return projects;
    const client = clients.find((c) => c.id === clientId);
    const allowed = new Set(client?.projectIds ?? []);
    return projects.filter((p) => allowed.has(p.id));
  }, [clientId, clients, projects]);

  const generateMutation = useMutation({
    mutationFn: () =>
      apiClient.agency.reports.generate({
        clientId: clientId || undefined,
        projectId: projectId || undefined,
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
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          money · reports
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Reports
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Generate a tabular summary for clients and internal review — per-token budget, spend, and
          builder totals. Download CSV for sharing.
        </p>
      </header>

      <Card>
        <CardContent className="p-5 grid gap-4 sm:grid-cols-2">
          <Field label="client filter (optional)" htmlFor="report-client">
            <select
              id="report-client"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setProjectId("");
              }}
              className={selectClass}
            >
              <option value="">all clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="project filter (optional)" htmlFor="report-project">
            <select
              id="report-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={selectClass}
            >
              <option value="">all projects</option>
              {projectOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </Field>
          <ReportNoteField id="report-note" value={note} onChange={setNote} />
          <Field label="start date (optional)" htmlFor="report-start">
            <input
              id="report-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={selectClass}
            />
          </Field>
          <Field label="end date (optional)" htmlFor="report-end">
            <input
              id="report-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={selectClass}
            />
          </Field>
          <div className="sm:col-span-2 flex flex-wrap gap-2">
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

      {report && <ReportPreview report={report} />}
    </div>
  );
}
