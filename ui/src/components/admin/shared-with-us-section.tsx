import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Badge, Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components";
import { AdminError } from "@/components/admin-error";
import { SectionHeader } from "@/components/page-header";
import { useApiClient } from "@/lib/api";
import { sharedWithUsQueryOptions } from "@/lib/queries";

export function SharedWithUsSection() {
  const apiClient = useApiClient();
  const sharedQuery = useQuery(sharedWithUsQueryOptions(apiClient));
  const shared = sharedQuery.data?.data ?? [];

  if (sharedQuery.isError) return <AdminError error={sharedQuery.error} />;
  if (shared.length === 0) return null;

  return (
    <section aria-labelledby="shared-with-us" className="flex flex-col gap-4">
      <SectionHeader
        id="shared-with-us"
        title="Shared with us"
        description="Projects other Agencies hired you for. Assign your builders and bill from your Agency DAO; the hiring Agency keeps the Project and its budget."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {shared.map((item) => (
          <Card key={`${item.engagementId}/${item.project.id}`}>
            <CardHeader>
              <CardTitle>
                <Link
                  to="/client/$engagementId/projects/$slug"
                  params={{ engagementId: item.engagementId, slug: item.project.slug }}
                  className="underline-offset-4 hover:underline"
                >
                  {item.project.title}
                </Link>
              </CardTitle>
              <CardDescription>For {item.agency.name}</CardDescription>
              <CardAction>
                <div className="flex flex-wrap justify-end gap-1">
                  <Badge variant="outline">{item.project.status}</Badge>
                  {item.readOnly && <Badge variant="secondary">Read-only</Badge>}
                </div>
              </CardAction>
            </CardHeader>
          </Card>
        ))}
      </div>
    </section>
  );
}
