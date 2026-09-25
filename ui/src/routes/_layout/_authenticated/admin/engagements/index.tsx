import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { Button, Card, CardContent, DataTable, Input } from "@/components";
import { Field, selectClass } from "@/components/admin-form";
import {
  EngagementKindBadge,
  EngagementStatusBadge,
  type EngagementView,
  InvitationStatusBadge,
} from "@/components/engagement-status";
import { useEngagementAction } from "@/hooks/use-engagement-action";
import { useApiClient } from "@/lib/api";
import { adminProjectsListQueryOptions, engagementsListQueryOptions } from "@/lib/queries";
import { isValidSlug, slugify } from "@/lib/slugify";

export const Route = createFileRoute("/_layout/_authenticated/admin/engagements/")({
  head: () => ({
    meta: [
      { title: "Engagements" },
      {
        name: "description",
        content: "The Clients your Organization works for and the Subcontractors it hires.",
      },
    ],
  }),
  component: EngagementsPage,
});

type EngagementKind = EngagementView["kind"];

const KIND_LABEL: Record<EngagementKind, string> = {
  client: "Client",
  subcontract: "Subcontractor",
};

function EngagementsPage() {
  const apiClient = useApiClient();
  const [kind, setKind] = useState<EngagementKind>("client");
  const engagementsQuery = useQuery(engagementsListQueryOptions(apiClient));
  const engagements = (engagementsQuery.data?.data ?? []).filter((e) => e.side === "agency");

  const columns: ColumnDef<EngagementView>[] = [
    {
      id: "client",
      header: "Organization",
      accessorFn: (row) => row.client.name,
      cell: ({ row }) => (
        <Link
          to="/admin/engagements/$engagementId"
          params={{ engagementId: row.original.id }}
          className="text-sm uppercase font-bold hover:underline"
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
          <EngagementKindBadge kind={row.original.kind} />
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
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          people · engagements
        </div>
        <h1 className="text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Engagements
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Each Engagement is a Client your Organization works for, or a Subcontractor it hires.
          Share Projects through it so the Client's team can follow the work, its budget and its
          billings, or so the Subcontractor can staff and pay its part.
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

      <section className="space-y-4">
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">engage as</legend>
          {(Object.keys(KIND_LABEL) as EngagementKind[]).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={kind === option ? "default" : "outline"}
              aria-pressed={kind === option}
              onClick={() => setKind(option)}
            >
              {option === "client" ? "add a client" : "hire a subcontractor"}
            </Button>
          ))}
        </fieldset>
        <div className="grid gap-6 lg:grid-cols-2">
          <NewOrganizationForm key={kind} kind={kind} />
          {kind === "client" ? <ProposeForm /> : <SubcontractForm />}
        </div>
      </section>
    </div>
  );
}

function ProjectPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string[];
  onChange: (projectIds: string[]) => void;
}) {
  const apiClient = useApiClient();
  const projects = useQuery(adminProjectsListQueryOptions(apiClient)).data?.data ?? [];
  return (
    <Field
      label="share projects (optional)"
      htmlFor={id}
      helper="Hold Ctrl or Cmd to pick several."
    >
      <select
        id={id}
        multiple
        value={value}
        onChange={(e) => onChange([...e.target.selectedOptions].map((option) => option.value))}
        className={`${selectClass} h-28`}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
    </Field>
  );
}

function useOpenEngagement() {
  const navigate = useNavigate();
  return (engagement: EngagementView) =>
    navigate({
      to: "/admin/engagements/$engagementId",
      params: { engagementId: engagement.id },
    });
}

function NewOrganizationForm({ kind }: { kind: EngagementKind }) {
  const apiClient = useApiClient();
  const openEngagement = useOpenEngagement();
  const label = KIND_LABEL[kind];
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);

  const create = useEngagementAction(
    () =>
      apiClient.engagements.createWithClient({
        name: name.trim(),
        slug: slug.trim(),
        adminEmail: adminEmail.trim(),
        projectIds,
        kind,
      }),
    (engagement) => `${engagement.client.name} created — invitation sent to ${adminEmail.trim()}`,
    { failure: `Could not create the ${label}`, onDone: openEngagement },
  );

  const valid = name.trim() && isValidSlug(slug.trim()) && adminEmail.includes("@");

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl uppercase font-extrabold">New {label}</h2>
          <p className="text-sm text-muted-foreground">
            Creates the {label}'s Organization and invites its first admin as owner. You do not join
            it: the {label} manages its own team once the invitation is accepted.
          </p>
        </div>
        <Field label={`${label.toLowerCase()} name`} htmlFor="new-client-name">
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
        <ProjectPicker id="new-client-projects" value={projectIds} onChange={setProjectIds} />
        <Button onClick={() => create.mutate()} disabled={!valid || create.isPending}>
          {create.isPending ? "creating..." : `create ${label.toLowerCase()} and invite`}
        </Button>
      </CardContent>
    </Card>
  );
}

function ProposeForm() {
  const apiClient = useApiClient();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");

  const propose = useEngagementAction(
    () => apiClient.engagements.propose({ slug: slug.trim(), name: name.trim() }),
    (engagement) => `Engagement proposed to ${engagement.client.name}`,
    {
      failure: "Could not propose the Engagement",
      onDone: () => {
        setSlug("");
        setName("");
      },
    },
  );

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl uppercase font-extrabold">Existing Organization</h2>
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

function SubcontractForm() {
  const apiClient = useApiClient();
  const openEngagement = useOpenEngagement();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);

  const subcontract = useEngagementAction(
    () => apiClient.engagements.subcontract({ slug: slug.trim(), name: name.trim(), projectIds }),
    (engagement) => `${engagement.client.name} now works on your shared Projects`,
    { failure: "Could not hire the Subcontractor", onDone: openEngagement },
  );

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl uppercase font-extrabold">Existing Agency</h2>
          <p className="text-sm text-muted-foreground">
            Ask the Agency for its slug (shown on its Settings page) and its exact name. The
            Subcontract starts at once, with no acceptance, and its owners and admins are told. You
            can record a Prepayment on it afterwards.
          </p>
        </div>
        <Field label="organization slug" htmlFor="subcontract-slug">
          <Input id="subcontract-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Field label="organization name" htmlFor="subcontract-name">
          <Input id="subcontract-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <ProjectPicker id="subcontract-projects" value={projectIds} onChange={setProjectIds} />
        <Button
          onClick={() => subcontract.mutate()}
          disabled={!slug.trim() || !name.trim() || subcontract.isPending}
        >
          {subcontract.isPending ? "hiring..." : "hire subcontractor"}
        </Button>
      </CardContent>
    </Card>
  );
}
