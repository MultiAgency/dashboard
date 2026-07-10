import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, DataTable, Input } from "@/components";
import type { ColumnDef } from "@/components/ui/data-table";
import type { Organization } from "@/lib/auth";
import { useAuthClient } from "@/lib/auth";

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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["platform", "orgs"] });

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
        const isAgency = ((row.original.metadata ?? {}) as Record<string, unknown>).type === "agency";
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
          Organizations
        </h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Create and manage organizations. Agency orgs have a Sputnik DAO linked. Client orgs are
          separate organizations that see the agency's work scoped to them.
        </p>
      </div>

      <section className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          create organization
        </div>
        <CreateOrgForm onCreated={invalidate} />
      </section>

      <section className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          all organizations ({orgs.length})
        </div>
        {orgsQuery.isError ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              {orgsQuery.error?.message || "Failed to load organizations"}
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
            emptyMessage="No organizations yet."
            csvFilename="organizations"
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

function CreateOrgForm({ onCreated }: { onCreated: () => void }) {
  const authClient = useAuthClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [orgType, setOrgType] = useState<"agency" | "client">("agency");
  const [daoAccountId, setDaoAccountId] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  const handleNameChange = (value: string) => {
    setName(value);
    setSlug(slugify(value));
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const metadata: Record<string, unknown> = {
        type: orgType,
      };
      if (orgType === "agency" && daoAccountId.trim()) {
        metadata.daoAccountId = daoAccountId.trim();
      }
      const finalSlug = slug.trim() || slugify(name);
      const org = await authClient.organization.create({
        name: name.trim(),
        slug: finalSlug,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
      if (!org.data?.id) throw new Error("Failed to create organization");
      await authClient.organization.inviteMember({
        email: adminEmail.trim(),
        role: "admin",
        organizationId: org.data.id,
      });
      return org.data;
    },
    onSuccess: (org) => {
      toast.success(`Organization "${org.name}" created`);
      setName("");
      setSlug("");
      setDaoAccountId("");
      setAdminEmail("");
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to create organization"),
  });

  const isPending = createMutation.isPending;
  const canSubmit = name.trim() && adminEmail.trim();

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="org-name" className={LABEL_CLS}>
              name
            </label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="My Agency"
              disabled={isPending}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="org-slug" className={LABEL_CLS}>
              slug
            </label>
            <Input
              id="org-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
              placeholder="auto-generated"
              disabled={isPending}
            />
            <p className="font-mono text-[10px] text-muted-foreground">
              auto-generated from name, but you can override.
            </p>
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="org-type" className={LABEL_CLS}>
            type
          </label>
          <select
            id="org-type"
            value={orgType}
            onChange={(e) => setOrgType(e.target.value as typeof orgType)}
            disabled={isPending}
            className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 font-mono text-xs"
          >
            <option value="agency">agency</option>
            <option value="client">client</option>
          </select>
        </div>
        {orgType === "agency" && (
          <div className="space-y-1">
            <label htmlFor="org-dao" className={LABEL_CLS}>
              sputnik dao account
            </label>
            <Input
              id="org-dao"
              value={daoAccountId}
              onChange={(e) => setDaoAccountId(e.target.value)}
              placeholder="multagency.sputnik-dao.near"
              disabled={isPending}
            />
            <p className="font-mono text-[10px] text-muted-foreground">
              optional — links this agency to a Sputnik DAO for treasury/proposals.
            </p>
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="org-admin-email" className={LABEL_CLS}>
            admin email
          </label>
          <Input
            id="org-admin-email"
            type="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            placeholder="admin@example.com"
            disabled={isPending}
          />
          <p className="font-mono text-[10px] text-muted-foreground">
            This person will receive an email invitation to join as the org's first admin.
          </p>
        </div>
        <Button
          onClick={() => createMutation.mutate()}
          disabled={!canSubmit || isPending}
          className="w-full font-display uppercase tracking-wide"
        >
          {isPending ? "creating…" : `create ${orgType} →`}
        </Button>
      </CardContent>
    </Card>
  );
}
