import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardContent, DataTable, Input } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Field } from "@/components/admin-form";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import { type AuthClient, useAuthClient } from "@/lib/auth";
import { isValidNearAccountId } from "@/lib/near-account";
import {
  adminClientsListQueryKey,
  adminClientsListQueryOptions,
  adminProjectsListQueryOptions,
  invalidateWorkspaceQueries,
} from "@/lib/queries";
import { ensureAgencyWorkspaceActive, resolveAgencyOrgId } from "@/lib/workspace";

type Client = Awaited<ReturnType<ApiClient["clients"]["list"]>>["data"][number];

export function ClientsAdminSection() {
  const apiClient = useApiClient();
  const clientsQuery = useQuery(adminClientsListQueryOptions(apiClient));
  const [creating, setCreating] = useState(false);

  if (clientsQuery.isError) {
    return <AdminError error={clientsQuery.error} />;
  }

  const columns: ColumnDef<Client>[] = [
    {
      id: "name",
      header: "Name",
      accessorKey: "name",
      cell: ({ row }) => (
        <Link
          to="/admin/clients/$clientId"
          params={{ clientId: row.original.id }}
          className="font-display text-sm uppercase tracking-tight font-bold hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      id: "nearAccountId",
      header: "NEAR (portal auth)",
      accessorKey: "nearAccountId",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.nearAccountId ?? "—"}
        </span>
      ),
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
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <Link
          to="/admin/clients/$clientId"
          params={{ clientId: row.original.id }}
          className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground hover:underline"
        >
          edit
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-end gap-3">
        <Button
          onClick={() => setCreating((v) => !v)}
          variant={creating ? "outline" : "default"}
          className="font-display uppercase tracking-wide"
        >
          {creating ? "cancel" : "+ new client"}
        </Button>
      </header>

      {creating && <ClientCreateForm onDone={() => setCreating(false)} />}

      <DataTable
        columns={columns}
        data={clientsQuery.data?.data ?? []}
        isLoading={clientsQuery.isLoading}
        error={clientsQuery.error}
        onRetry={() => clientsQuery.refetch()}
        emptyMessage="No clients yet. Create your first one above."
        csvFilename="clients"
        viewId="admin-clients"
        searchPlaceholder="Search clients…"
      />
    </div>
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function isOrgAlreadyExistsError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  if (error.code === "ORGANIZATION_ALREADY_EXISTS") return true;
  const message = error.message?.toLowerCase() ?? "";
  return message.includes("organization already exists");
}

/** Create a client Better Auth org, or reuse one left over from a failed prior attempt. */
async function ensureClientOrgId(authClient: AuthClient, name: string): Promise<string> {
  const trimmedName = name.trim();
  const slug = slugify(trimmedName);

  const created = await authClient.organization.create({
    name: trimmedName,
    slug,
    metadata: { type: "client" },
  });
  if (created.data?.id) return created.data.id;

  if (!isOrgAlreadyExistsError(created.error)) {
    throw new Error(created.error?.message || "Failed to create client workspace");
  }

  const list = await authClient.organization.list();
  const existing = (list.data ?? []).find((org) => org.slug === slug);
  if (!existing?.id) {
    throw new Error(
      `Workspace slug "${slug}" is already taken. Pick a different client name, or ask a platform admin to remove the orphan org.`,
    );
  }
  return existing.id;
}

type ProjectOption = { id: string; title: string };

function LinkedProjectsPicker({
  projects,
  value,
  onChange,
  disabled,
  id,
}: {
  projects: ProjectOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  id?: string;
}) {
  const selected = projects.filter((p) => value.includes(p.id));
  const label =
    selected.length === 0
      ? "Select projects…"
      : selected.length === 1
        ? selected[0]!.title
        : `${selected.length} projects linked`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className="h-9 w-full justify-between px-3 font-normal"
        >
          <span className="truncate text-left">{label}</span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-60 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
      >
        {projects.map((project) => (
          <DropdownMenuCheckboxItem
            key={project.id}
            checked={value.includes(project.id)}
            onCheckedChange={(checked) => {
              onChange(checked ? [...value, project.id] : value.filter((id) => id !== project.id));
            }}
            onSelect={(e) => e.preventDefault()}
          >
            {project.title}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ClientCreateForm({ onDone }: { onDone: () => void }) {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));
  const [name, setName] = useState("");
  const [nearAccountId, setNearAccountId] = useState("");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      const agencyToRestore = await resolveAgencyOrgId(authClient);
      const orgId = await ensureClientOrgId(authClient, trimmedName);

      const existing = (await apiClient.clients.list()).data.find((c) => c.orgId === orgId);
      if (existing) {
        if (agencyToRestore) await ensureAgencyWorkspaceActive(authClient);
        return { client: existing, projectIds: selectedProjects, alreadyExists: true as const };
      }

      const result = await apiClient.clients.create({
        orgId,
        name: trimmedName,
        nearAccountId: nearAccountId.trim() || undefined,
        projectIds: selectedProjects.length > 0 ? selectedProjects : undefined,
      });
      if (agencyToRestore) await ensureAgencyWorkspaceActive(authClient);
      return { ...result, alreadyExists: false as const };
    },
    onSuccess: async (result) => {
      await invalidateWorkspaceQueries(queryClient, router);
      await queryClient.invalidateQueries({ queryKey: adminClientsListQueryKey });
      toast.success(
        result.alreadyExists
          ? "Client workspace already existed — linked record restored"
          : "Client created",
      );
      onDone();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to create client"),
  });

  const nearTrimmed = nearAccountId.trim();
  const nearOk = !nearTrimmed || isValidNearAccountId(nearTrimmed);
  const canSubmit = name.trim().length > 0 && nearOk && !createMutation.isPending;
  const projects = projectsQuery.data?.data ?? [];

  return (
    <Card>
      <CardContent className="p-5 grid gap-4">
        <Field label="name" htmlFor="client-name">
          <Input
            id="client-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={createMutation.isPending}
          />
        </Field>
        <Field
          label="near account (portal auth)"
          htmlFor="client-near"
          helper="Clients sign in with this NEAR wallet to access the portal."
        >
          <Input
            id="client-near"
            value={nearAccountId}
            onChange={(e) => setNearAccountId(e.target.value)}
            placeholder="client.near"
            disabled={createMutation.isPending}
          />
          {nearTrimmed && !nearOk && (
            <p className="text-xs text-destructive">Invalid NEAR account id</p>
          )}
        </Field>
        {projects.length > 0 && (
          <Field
            label="linked projects"
            htmlFor="client-projects"
            helper="Select one or more projects this client can see in their portal."
          >
            <LinkedProjectsPicker
              id="client-projects"
              projects={projects}
              value={selectedProjects}
              onChange={setSelectedProjects}
              disabled={createMutation.isPending}
            />
          </Field>
        )}
        <div className="flex gap-2">
          <Button onClick={() => createMutation.mutate()} disabled={!canSubmit}>
            {createMutation.isPending ? "creating..." : "create client"}
          </Button>
          <Button onClick={onDone} variant="outline" disabled={createMutation.isPending}>
            cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ClientDetailSection({ clientId }: { clientId: string }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  const detailQuery = useQuery({
    queryKey: ["admin", "clients", "detail", clientId],
    queryFn: () => apiClient.clients.get({ id: clientId }),
    retry: false,
  });
  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));

  const [name, setName] = useState("");
  const [nearAccountId, setNearAccountId] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);

  useEffect(() => {
    if (detailQuery.data) {
      setName(detailQuery.data.client.name);
      setNearAccountId(detailQuery.data.client.nearAccountId ?? "");
      setProjectIds(detailQuery.data.projectIds);
    }
  }, [detailQuery.data]);

  const updateMutation = useMutation({
    mutationFn: async () =>
      apiClient.clients.update({
        id: clientId,
        name: name.trim(),
        nearAccountId: nearAccountId.trim() || null,
        projectIds,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminClientsListQueryKey });
      await queryClient.invalidateQueries({ queryKey: ["admin", "clients", "detail", clientId] });
      toast.success("Client updated");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to update client"),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => apiClient.clients.delete({ id: clientId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminClientsListQueryKey });
      await router.invalidate();
      toast.success("Client deleted");
      void navigate({ to: "/admin/clients" });
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete client"),
  });

  if (detailQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading client…</p>;
  }
  if (detailQuery.isError) {
    return <AdminError error={detailQuery.error} />;
  }

  const projects = projectsQuery.data?.data ?? [];

  return (
    <Card>
      <CardContent className="p-5 grid gap-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          edit client
        </div>
        <Field label="name" htmlFor="edit-client-name">
          <Input
            id="edit-client-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={updateMutation.isPending}
          />
        </Field>
        <Field
          label="near account (portal auth)"
          htmlFor="edit-client-near"
          helper="Clients sign in with this NEAR wallet to access the portal."
        >
          <Input
            id="edit-client-near"
            value={nearAccountId}
            onChange={(e) => setNearAccountId(e.target.value)}
            disabled={updateMutation.isPending}
          />
        </Field>
        {projects.length > 0 && (
          <Field
            label="linked projects"
            htmlFor="edit-client-projects"
            helper="Select one or more projects this client can see in their portal."
          >
            <LinkedProjectsPicker
              id="edit-client-projects"
              projects={projects}
              value={projectIds}
              onChange={setProjectIds}
              disabled={updateMutation.isPending}
            />
          </Field>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={!name.trim() || updateMutation.isPending}
            size="sm"
          >
            {updateMutation.isPending ? "saving..." : "save changes"}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (window.confirm(`Delete client "${name}"? This cannot be undone.`)) {
                deleteMutation.mutate();
              }
            }}
          >
            {deleteMutation.isPending ? "deleting..." : "delete client"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
