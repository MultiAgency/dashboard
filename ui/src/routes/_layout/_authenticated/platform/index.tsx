import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, DataTable, Input } from "@/components";
import type { ColumnDef } from "@/components/ui/data-table";
import type { Organization } from "@/lib/auth";
import { organizationsListQueryKey, sessionQueryKey, useAuthClient } from "@/lib/auth";

export const Route = createFileRoute("/_layout/_authenticated/platform/")({
  head: () => ({
    meta: [{ title: "Platform | Admin" }],
  }),
  component: PlatformOrgs,
});

type PlatformOrg = Organization;

const LABEL_CLS = "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground block";

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
    queryClient.invalidateQueries({ queryKey: organizationsListQueryKey });
    queryClient.invalidateQueries({ queryKey: sessionQueryKey });
  };

  const orgs = orgsQuery.data ?? [];

  const columns: ColumnDef<PlatformOrg>[] = [
    {
      id: "name",
      header: "Name",
      accessorKey: "name",
    },
    {
      id: "slug",
      header: "Slug",
      accessorKey: "slug",
    },
    {
      id: "type",
      header: "Type",
      cell: ({ row }) => {
        const rawMeta = row.original.metadata;
        const meta = typeof rawMeta === "string" ? JSON.parse(rawMeta) : (rawMeta ?? {});
        const isAgency = (meta as Record<string, unknown>).type === "agency";
        return (
          <Badge variant={isAgency ? "default" : "outline"}>{isAgency ? "agency" : "client"}</Badge>
        );
      },
    },
    {
      id: "createdAt",
      header: "Created",
      accessorKey: "createdAt",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.createdAt.toISOString().slice(0, 10)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Workspaces
        </h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Create agency workspaces with a linked Sputnik DAO. You become the owner; the admin email
          receives a separate invite. Create paying clients from Admin → Clients instead.
        </p>
      </div>

      <section className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          create agency workspace
        </div>
        <CreateAgencyForm onCreated={invalidate} />
      </section>

      <section className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          all workspaces ({orgs.length})
        </div>
        {orgsQuery.isError ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              {orgsQuery.error?.message || "Failed to load workspaces"}
            </p>
            <Button variant="outline" size="sm" onClick={invalidate}>
              retry
            </Button>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={orgs}
            isLoading={orgsQuery.isLoading}
            emptyMessage="No workspaces yet."
            csvFilename="workspaces"
          />
        )}
      </section>
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
  const [daoAccountId, setDaoAccountId] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  const handleNameChange = (value: string) => {
    setName(value);
    setSlug(slugify(value));
  };

  const resetForm = () => {
    setName("");
    setSlug("");
    setDaoAccountId("");
    setAdminEmail("");
    setFormKey((k) => k + 1);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const finalSlug = slug.trim() || slugify(name);
      const org = await authClient.organization.create({
        name: name.trim(),
        slug: finalSlug,
        metadata: {
          type: "agency",
          daoAccountId: daoAccountId.trim(),
        },
      });
      if (org.error) throw new Error(org.error.message || "Failed to create workspace");
      if (!org.data?.id) throw new Error("Failed to create workspace");

      const invite = await authClient.organization.inviteMember({
        email: adminEmail.trim(),
        role: "admin",
        organizationId: org.data.id,
      });

      return {
        org: org.data,
        inviteError: invite.error?.message ?? null,
      };
    },
    onSuccess: ({ org, inviteError }) => {
      if (inviteError) {
        toast.warning(
          `Agency "${org.name}" was created and you were added as owner, but the admin invite failed: ${inviteError}`,
        );
      } else {
        toast.success(
          `Agency "${org.name}" created — you are owner; invite sent to ${adminEmail.trim()}`,
        );
      }
      resetForm();
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to create workspace"),
  });

  const isPending = createMutation.isPending;
  const canSubmit = !!name.trim() && !!adminEmail.trim() && !!daoAccountId.trim();

  return (
    <Card key={formKey}>
      <CardContent className="p-4 space-y-4">
        <form
          autoComplete="off"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit && !isPending) createMutation.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="workspace-name" className={LABEL_CLS}>
                name
              </label>
              <Input
                id="workspace-name"
                name="workspace-name"
                autoComplete="off"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Acme Agency"
                disabled={isPending}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="workspace-slug" className={LABEL_CLS}>
                slug
              </label>
              <Input
                id="workspace-slug"
                name="workspace-slug"
                autoComplete="off"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                placeholder="acme-agency"
                disabled={isPending}
              />
              <p className="font-mono text-[10px] text-muted-foreground">
                auto-generated from name, but you can override.
              </p>
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="workspace-dao" className={LABEL_CLS}>
              sputnik dao account (required)
            </label>
            <Input
              id="workspace-dao"
              name="workspace-dao"
              autoComplete="off"
              value={daoAccountId}
              onChange={(e) => setDaoAccountId(e.target.value)}
              placeholder="your-org.sputnik-dao.near"
              disabled={isPending}
            />
            <p className="font-mono text-[10px] text-muted-foreground">
              links this workspace to a Sputnik DAO for treasury and proposals.
            </p>
          </div>
          <div className="space-y-1">
            <label htmlFor="workspace-admin-email" className={LABEL_CLS}>
              agency admin email
            </label>
            <Input
              id="workspace-admin-email"
              name="workspace-admin-email"
              type="email"
              autoComplete="off"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="admin@example.com"
              disabled={isPending}
            />
            <p className="font-mono text-[10px] text-muted-foreground">
              invited as admin. You (the creator) are added as owner automatically — this email is
              for the person who will run the agency day-to-day.
            </p>
          </div>
          <Button
            type="submit"
            disabled={!canSubmit || isPending}
            className="w-full font-display uppercase tracking-wide"
          >
            {isPending ? "creating…" : "create agency →"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
