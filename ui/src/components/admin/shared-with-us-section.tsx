import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Badge, Card, CardContent } from "@/components";
import { AdminError } from "@/components/admin-error";
import { useApiClient } from "@/lib/api";
import { sharedWithUsQueryOptions } from "@/lib/queries";

export function SharedWithUsSection() {
  const apiClient = useApiClient();
  const sharedQuery = useQuery(sharedWithUsQueryOptions(apiClient));
  const shared = sharedQuery.data?.data ?? [];

  if (sharedQuery.isError) return <AdminError error={sharedQuery.error} />;
  if (shared.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-2xl uppercase tracking-tight font-extrabold leading-tight">
          Shared with us
        </h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Projects other Agencies hired you to work on. Assign your builders, bill them from your
          Agency DAO and report back; the hiring Agency keeps the Project and its budget.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {shared.map((item) => (
          <Card key={`${item.engagementId}/${item.project.id}`}>
            <CardContent className="p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{item.project.status}</Badge>
                {item.readOnly && <Badge variant="secondary">read-only</Badge>}
              </div>
              <Link
                to="/client/$engagementId/projects/$slug"
                params={{ engagementId: item.engagementId, slug: item.project.slug }}
                className="text-lg uppercase font-extrabold hover:underline"
              >
                {item.project.title}
              </Link>
              <p className="text-xs text-muted-foreground">for {item.agency.name}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
