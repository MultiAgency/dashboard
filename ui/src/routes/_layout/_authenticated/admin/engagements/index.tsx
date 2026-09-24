import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardContent, DataTable, Input } from "@/components";
import { Field, selectClass } from "@/components/admin-form";
import {
  EngagementStatusBadge,
  type EngagementView,
  InvitationStatusBadge,
} from "@/components/engagement-status";
import { useApiClient } from "@/lib/api";
import {
  adminProjectsListQueryOptions,
  engagementsListQueryOptions,
  refreshAfter,
} from "@/lib/queries";
import { isValidSlug, slugify } from "@/lib/slugify";

export const Route = createFileRoute("/_layout/_authenticated/admin/engagements/")({
  head: () => ({
    meta: [
      { title: "Engagements" },
      { name: "description", content: "The Clients your Organization works for." },
    ],
  }),
  component: EngagementsPage,
});

function EngagementsPage() {
  const apiClient = useApiClient();
  const engagementsQuery = useQuery(engagementsListQueryOptions(apiClient));
  const engagements = (engagementsQuery.data?.data ?? []).filter((e) => e.side === "agency");

  const columns: ColumnDef<EngagementView>[] = [
    {
      id: "client",
      header: "Client",
      accessorFn: (row) => row.client.name,
      cell: ({ row }) => (
        <Link
          to="/admin/engagements/$engagementId"
          params={{ engagementId: row.original.id }}
          className="font-display text-sm uppercase font-bold hover:underline"
        >
          {row.original.client.name}
        </Link>
      ),
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          <EngagementStatusBadge status={row.original.status} />
          {row.original.invitation && row.original.invitation.status !== "accepted" && (
            <InvitationStatusBadge invitation={row.original.invitation} />
          )}
        </div>
      ),
    },
    {
      id: "projects",
      header: "Shared projects",
      accessorFn: (row) => row.projectIds.length,
    },
    {
      id: "updatedAt",
      header: "Updated",
      accessorFn: (row) => new Date(row.updatedAt).toISOString(),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {new Date(row.original.updatedAt).toISOString().slice(0, 10)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          people · engagements
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Engagements
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Each Engagement is a Client your Organization works for. Share Projects through it so the
          Client's team can follow the work, its budget and its billings.
        </p>
      </header>

      <DataTable
        readOnly
        columns={columns}
        data={engagements}
        isLoading={engagementsQuery.isLoading}
        error={engagementsQuery.error}
        onRetry={() => engagementsQuery.refetch()}
        emptyMessage="No Engagements yet. Add a new Client or propose one to an existing Organization below."
        csvFilename="engagements"
        viewId="admin-engagements"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <NewClientForm />
        <ProposeForm />
      </div>
    </div>
  );
}

function NewClientForm() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));
  const projects = projectsQuery.data?.data ?? [];
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: () =>
      apiClient.engagements.createWithClient({
        name: name.trim(),
        slug: slug.trim(),
        adminEmail: adminEmail.trim(),
        projectIds,
      }),
    onSuccess: async (engagement) => {
      await refreshAfter(queryClient, { type: "engagements" });
      toast.success(`${engagement.client.name} created — invitation sent to ${adminEmail.trim()}`);
      navigate({
        to: "/admin/engagements/$engagementId",
        params: { engagementId: engagement.id },
      });
    },
    onError: (e: Error) => toast.error(e.message || "Could not create the Client"),
  });

  const valid = name.trim() && isValidSlug(slug.trim()) && adminEmail.includes("@");

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-xl uppercase font-extrabold">New Client</h2>
          <p className="text-sm text-muted-foreground">
            Creates the Client's Organization and invites its first admin as owner. You do not join
            it: the Client manages its own team once the invitation is accepted.
          </p>
        </div>
        <Field label="client name" htmlFor="new-client-name">
          <Input
            id="new-client-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field label="slug" htmlFor="new-client-slug">
          <Input
            id="new-client-slug"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
          />
        </Field>
        <Field label="first admin's email" htmlFor="new-client-email">
          <Input
            id="new-client-email"
            type="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
          />
        </Field>
        <Field
          label="share projects (optional)"
          htmlFor="new-client-projects"
          helper="Hold Ctrl or Cmd to pick several."
        >
          <select
            id="new-client-projects"
            multiple
            value={projectIds}
            onChange={(e) =>
              setProjectIds([...e.target.selectedOptions].map((option) => option.value))
            }
            className={`${selectClass} h-28`}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>
        <Button onClick={() => create.mutate()} disabled={!valid || create.isPending}>
          {create.isPending ? "creating..." : "create client and invite"}
        </Button>
      </CardContent>
    </Card>
  );
}

function ProposeForm() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");

  const propose = useMutation({
    mutationFn: () => apiClient.engagements.propose({ slug: slug.trim(), name: name.trim() }),
    onSuccess: async (engagement) => {
      await refreshAfter(queryClient, { type: "engagements" });
      toast.success(`Engagement proposed to ${engagement.client.name}`);
      setSlug("");
      setName("");
    },
    onError: (e: Error) => toast.error(e.message || "Could not propose the Engagement"),
  });

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-xl uppercase font-extrabold">Existing Organization</h2>
          <p className="text-sm text-muted-foreground">
            Ask the Organization for its slug (shown on its Settings page) and its exact name. Its
            owners and admins accept or decline your proposal.
          </p>
        </div>
        <Field label="organization slug" htmlFor="propose-slug">
          <Input id="propose-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Field label="organization name" htmlFor="propose-name">
          <Input id="propose-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button
          onClick={() => propose.mutate()}
          disabled={!slug.trim() || !name.trim() || propose.isPending}
        >
          {propose.isPending ? "proposing..." : "propose engagement"}
        </Button>
      </CardContent>
    </Card>
  );
}
