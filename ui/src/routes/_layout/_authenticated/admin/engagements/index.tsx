import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { type ReactNode, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DataTable,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from "@/components";
import {
  EngagementKindBadge,
  EngagementStatusBadge,
  type EngagementView,
  InvitationStatusBadge,
} from "@/components/engagement-status";
import { PageHeader, SectionHeader } from "@/components/page-header";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldLegend, FieldSet } from "@/components/ui/field";
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

const columns: ColumnDef<EngagementView>[] = [
  {
    id: "client",
    header: "Organization",
    accessorFn: (row) => row.client.name,
    cell: ({ row }) => (
      <Link
        to="/admin/engagements/$engagementId"
        params={{ engagementId: row.original.id }}
        className="font-medium underline-offset-4 hover:underline"
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
    header: "Shared Projects",
    accessorFn: (row) => row.projectIds.length,
  },
  {
    id: "updatedAt",
    header: "Updated",
    accessorFn: (row) => new Date(row.updatedAt).toISOString(),
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {new Date(row.original.updatedAt).toISOString().slice(0, 10)}
      </span>
    ),
  },
];

function EngagementsPage() {
  const apiClient = useApiClient();
  const [kind, setKind] = useState<EngagementKind>("client");
  const engagementsQuery = useQuery(engagementsListQueryOptions(apiClient));
  const engagements = (engagementsQuery.data?.data ?? []).filter((e) => e.side === "agency");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Engagements"
        description="The Clients your Organization works for and the Subcontractors it hires. Share Projects through an Engagement so they can follow or staff the work."
      />

      <DataTable
        readOnly
        columns={columns}
        data={engagements}
        isLoading={engagementsQuery.isLoading}
        error={engagementsQuery.error}
        onRetry={() => engagementsQuery.refetch()}
        emptyMessage="No Engagements yet. Start one below."
        csvFilename="engagements"
        viewId="admin-engagements"
      />

      <section aria-labelledby="start-engagement" className="flex flex-col gap-4">
        <SectionHeader
          id="start-engagement"
          title="Start an Engagement"
          description="Add a Client you work for, or hire a Subcontractor for your Projects."
          actions={
            <ToggleGroup
              type="single"
              variant="outline"
              spacing={0}
              aria-label="Engagement kind"
              value={kind}
              onValueChange={(value) => {
                if (value === "client" || value === "subcontract") setKind(value);
              }}
            >
              <ToggleGroupItem value="client">Client</ToggleGroupItem>
              <ToggleGroupItem value="subcontract">Subcontractor</ToggleGroupItem>
            </ToggleGroup>
          }
        />
        <Tabs key={kind} defaultValue="new">
          <TabsList>
            <TabsTrigger value="new">New {KIND_LABEL[kind]}</TabsTrigger>
            <TabsTrigger value="existing">
              {kind === "client" ? "Existing Organization" : "Existing Agency"}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="new" className="mt-2">
            <NewOrganizationForm kind={kind} />
          </TabsContent>
          <TabsContent value="existing" className="mt-2">
            {kind === "client" ? <ProposeForm /> : <SubcontractForm />}
          </TabsContent>
        </Tabs>
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
    <FieldSet>
      <FieldLegend variant="label">Share Projects (optional)</FieldLegend>
      {projects.length === 0 ? (
        <FieldDescription>You have no Projects to share yet.</FieldDescription>
      ) : (
        <div className="grid max-h-56 gap-3 overflow-y-auto border p-3 sm:grid-cols-2">
          {projects.map((p) => {
            const checkboxId = `${id}-${p.id}`;
            return (
              <Field key={p.id} orientation="horizontal">
                <Checkbox
                  id={checkboxId}
                  checked={value.includes(p.id)}
                  onCheckedChange={(checked) =>
                    onChange(checked === true ? [...value, p.id] : value.filter((v) => v !== p.id))
                  }
                />
                <FieldLabel htmlFor={checkboxId}>{p.title}</FieldLabel>
              </Field>
            );
          })}
        </div>
      )}
    </FieldSet>
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

function FormCard({
  title,
  description,
  onSubmit,
  reason,
  submit,
  children,
}: {
  title: string;
  description: string;
  onSubmit: () => void;
  reason: string | null;
  submit: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <form
        className="contents"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason) onSubmit();
        }}
      >
        <CardContent>
          <FieldGroup>{children}</FieldGroup>
        </CardContent>
        <CardFooter className="flex-wrap justify-end gap-3">
          {reason && <p className="mr-auto text-xs text-muted-foreground">{reason}</p>}
          {submit}
        </CardFooter>
      </form>
    </Card>
  );
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
    (engagement) => `${engagement.client.name} created, invitation sent to ${adminEmail.trim()}`,
    { failure: `Could not create the ${label}`, onDone: openEngagement },
  );

  const slugInvalid = slug.trim() !== "" && !isValidSlug(slug.trim());
  const reason = !name.trim()
    ? `Enter the ${label}'s name.`
    : !isValidSlug(slug.trim())
      ? "Enter a valid slug."
      : !adminEmail.includes("@")
        ? "Enter the first admin's email."
        : null;

  return (
    <FormCard
      title={`New ${label}`}
      description={`Creates the ${label}'s Organization and invites its first admin as owner. You don't join it.`}
      onSubmit={() => create.mutate()}
      reason={reason}
      submit={
        <Button type="submit" disabled={reason !== null || create.isPending}>
          {create.isPending ? "Creating…" : `Create ${label} and invite`}
        </Button>
      }
    >
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="new-client-name">Name</FieldLabel>
          <Input
            id="new-client-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field data-invalid={slugInvalid || undefined}>
          <FieldLabel htmlFor="new-client-slug">Slug</FieldLabel>
          <Input
            id="new-client-slug"
            value={slug}
            aria-invalid={slugInvalid || undefined}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
          />
          {slugInvalid ? (
            <FieldError>Use lowercase letters, numbers and dashes.</FieldError>
          ) : (
            <FieldDescription>Filled in from the name.</FieldDescription>
          )}
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="new-client-email">First admin's email</FieldLabel>
        <Input
          id="new-client-email"
          type="email"
          value={adminEmail}
          placeholder="name@example.com"
          onChange={(e) => setAdminEmail(e.target.value)}
        />
        <FieldDescription>
          They get an invitation and manage the {label}'s team once they accept.
        </FieldDescription>
      </Field>
      <ProjectPicker id="new-client-projects" value={projectIds} onChange={setProjectIds} />
    </FormCard>
  );
}

function OrganizationLookupFields({
  idPrefix,
  slug,
  name,
  setSlug,
  setName,
}: {
  idPrefix: string;
  slug: string;
  name: string;
  setSlug: (value: string) => void;
  setName: (value: string) => void;
}) {
  return (
    <div className="grid items-start gap-4 sm:grid-cols-2">
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-slug`}>Organization slug</FieldLabel>
        <Input id={`${idPrefix}-slug`} value={slug} onChange={(e) => setSlug(e.target.value)} />
        <FieldDescription>Shown on its Settings page.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-name`}>Organization name</FieldLabel>
        <Input id={`${idPrefix}-name`} value={name} onChange={(e) => setName(e.target.value)} />
        <FieldDescription>Its exact name, as a check.</FieldDescription>
      </Field>
    </div>
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
  const reason = !slug.trim() || !name.trim() ? "Enter the Organization's slug and name." : null;

  return (
    <FormCard
      title="Existing Organization"
      description="Propose an Engagement to an Organization that already exists. Its owners and admins accept or decline."
      onSubmit={() => propose.mutate()}
      reason={reason}
      submit={
        <Button type="submit" disabled={reason !== null || propose.isPending}>
          {propose.isPending ? "Proposing…" : "Propose Engagement"}
        </Button>
      }
    >
      <OrganizationLookupFields
        idPrefix="propose"
        slug={slug}
        name={name}
        setSlug={setSlug}
        setName={setName}
      />
    </FormCard>
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
  const reason = !slug.trim() || !name.trim() ? "Enter the Agency's slug and name." : null;

  return (
    <FormCard
      title="Existing Agency"
      description="Starts at once, with no acceptance; its owners and admins are told. You can record a Prepayment on it afterwards."
      onSubmit={() => subcontract.mutate()}
      reason={reason}
      submit={
        <Button type="submit" disabled={reason !== null || subcontract.isPending}>
          {subcontract.isPending ? "Hiring…" : "Hire Subcontractor"}
        </Button>
      }
    >
      <OrganizationLookupFields
        idPrefix="subcontract"
        slug={slug}
        name={name}
        setSlug={setSlug}
        setName={setName}
      />
      <ProjectPicker id="subcontract-projects" value={projectIds} onChange={setProjectIds} />
    </FormCard>
  );
}
