import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DataTable,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
} from "@/components";
import { LoadError } from "@/components/load-error";
import { OrganizationRequests } from "@/components/organization-requests";
import { PageHeader } from "@/components/page-header";
import type { ColumnDef } from "@/components/ui/data-table";
import type { Organization } from "@/lib/auth";
import { sessionQueryKey, useAuthClient } from "@/lib/auth";
import { isActiveOrganization } from "@/lib/landing";
import { organizationRequestsQueryKey } from "@/lib/queries";
import { availableSlug, isOrganizationSlugTaken } from "@/lib/slugify";

export const Route = createFileRoute("/_authenticated/platform/")({
  head: () => ({
    meta: [{ title: "Platform | Admin" }],
  }),
  component: PlatformOrgs,
});

type PlatformOrg = Organization;

function PlatformOrgs() {
  const authClient = useAuthClient();
  const queryClient = useQueryClient();

  const orgsQuery = useQuery({
    queryKey: ["platform", "orgs"],
    queryFn: async () => {
      const res = await authClient.organization.list();
      return res.data ?? [];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["platform", "orgs"] });
    queryClient.invalidateQueries({ queryKey: ["organizations", "list"] });
    queryClient.invalidateQueries({ queryKey: organizationRequestsQueryKey });
    queryClient.invalidateQueries({ queryKey: sessionQueryKey });
  };

  const orgs = orgsQuery.data ?? [];

  const columns: ColumnDef<PlatformOrg>[] = [
    {
      id: "name",
      header: "Name",
      accessorKey: "name",
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      id: "slug",
      header: "Slug",
      accessorKey: "slug",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.slug}</span>,
    },
    {
      id: "createdAt",
      header: "Created",
      accessorKey: "createdAt",
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums">
          {row.original.createdAt
            ? new Date(row.original.createdAt).toISOString().slice(0, 10)
            : ""}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Workspaces"
        description="Create Organizations and approve the ones people ask for. You become the owner of those you create."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/platform/members">Members</Link>
          </Button>
        }
      />

      <CreateAgencyForm onCreated={invalidate} />

      <OrganizationRequests onReviewed={invalidate} />

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>All workspaces</h2>
          </CardTitle>
          <CardDescription>Every Organization on this platform.</CardDescription>
          <CardAction>
            <Badge variant="secondary">{orgs.length}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {orgsQuery.isError ? (
            <LoadError
              title="Could not load workspaces"
              description={orgsQuery.error?.message || "Check your connection and try again."}
              onRetry={invalidate}
            />
          ) : (
            <DataTable
              columns={columns}
              data={orgs}
              isLoading={orgsQuery.isLoading}
              emptyMessage="No workspaces yet"
              csvFilename="workspaces"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function CreateAgencyForm({ onCreated }: { onCreated: () => void }) {
  const authClient = useAuthClient();
  const [formKey, setFormKey] = useState(0);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const handleNameChange = (value: string) => {
    setName(value);
    setSlug(slugify(value));
  };

  const resetForm = () => {
    setName("");
    setSlug("");
    setFormKey((k) => k + 1);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const finalSlug = slug.trim() || slugify(name);
      const org = await authClient.organization.create({
        name: name.trim(),
        slug: finalSlug,
      });
      if (isOrganizationSlugTaken(org.error?.code)) {
        const isTaken = async (candidate: string) =>
          !!(await authClient.organization.checkSlug({ slug: candidate })).error;
        const suggestion = await availableSlug(finalSlug, isTaken);
        throw new Error(
          suggestion
            ? `The slug "${finalSlug}" is already taken. Try "${suggestion}".`
            : `The slug "${finalSlug}" is already taken.`,
        );
      }
      if (org.error) throw new Error(org.error.message || "Failed to create workspace");
      if (!org.data?.id) throw new Error("Failed to create workspace");
      return org.data;
    },
    onSuccess: (org) => {
      if (isActiveOrganization(org)) {
        toast.success(`"${org.name}" created. You are its owner.`);
      } else {
        toast.info(
          `"${org.name}" is waiting for approval. Approve it under Pending approval to set its Agency DAO and admin.`,
        );
      }
      resetForm();
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to create workspace"),
  });

  const isPending = createMutation.isPending;
  const canSubmit = !!name.trim();

  return (
    <Card key={formKey}>
      <CardHeader>
        <CardTitle>
          <h2>Create an Organization</h2>
        </CardTitle>
        <CardDescription>
          New Organizations wait for approval. Set the Agency DAO and admin when you approve it.
        </CardDescription>
      </CardHeader>
      <form
        autoComplete="off"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !isPending) createMutation.mutate();
        }}
      >
        <CardContent>
          <FieldGroup>
            <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
              <Field>
                <FieldLabel htmlFor="workspace-name">Name</FieldLabel>
                <Input
                  id="workspace-name"
                  name="workspace-name"
                  autoComplete="off"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Acme Agency"
                  disabled={isPending}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="workspace-slug">Slug</FieldLabel>
                <Input
                  id="workspace-slug"
                  name="workspace-slug"
                  autoComplete="off"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                  placeholder="acme-agency"
                  disabled={isPending}
                />
                <FieldDescription>Generated from the name; you can override it.</FieldDescription>
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={!canSubmit || isPending}>
            {isPending ? "Creating…" : "Create Organization"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
