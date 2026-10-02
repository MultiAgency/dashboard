import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ClientReports } from "@/components/client/client-reports";

export const Route = createFileRoute("/_layout/_authenticated/client/$engagementId/reports")({
  validateSearch: z.object({ report: z.string().optional().catch(undefined) }),
  component: ClientReportsPage,
});

function ClientReportsPage() {
  const { engagement } = Route.useRouteContext();
  const { report } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ClientReports
      engagement={engagement}
      reportId={report}
      onOpenReport={(id) => void navigate({ search: { report: id } })}
    />
  );
}
