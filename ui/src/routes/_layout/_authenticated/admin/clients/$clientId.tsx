import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ClientDetailSection } from "@/components/admin/clients-section";
import { AdminSectionError, AdminSectionSkeleton } from "@/components/admin-section-states";
import { adminClientDetailQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/admin/clients/$clientId")({
  head: ({ params }) => ({
    meta: [{ title: `${params.clientId} | Admin · Clients` }],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      adminClientDetailQueryOptions(context.apiClient, params.clientId),
    ),
  pendingComponent: () => <AdminSectionSkeleton rows={4} />,
  errorComponent: ({ error, reset }) => <AdminSectionError error={error} onRetry={reset} />,
  component: AdminClientDetailPage,
});

function AdminClientDetailPage() {
  const { clientId } = Route.useParams();
  const apiClient = Route.useRouteContext().apiClient;
  const detailQuery = useQuery(adminClientDetailQueryOptions(apiClient, clientId));
  const client = detailQuery.data?.client;
  if (detailQuery.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!client) return null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/admin/clients"
          className="text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          ← all clients
        </Link>
      </div>
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          admin · clients
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          {client.name}
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Edit this client&apos;s portal settings below. The NEAR account controls who can sign in
          to the read-only client portal; linked projects determine what they can see.
        </p>
      </header>
      <ClientDetailSection clientId={clientId} />
    </div>
  );
}
