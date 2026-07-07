import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardContent, Input, Spinner } from "@/components";
import { useApiClient } from "@/lib/api";
import {
  LABEL_CLS,
  orgSiteUrl,
  ProjectRow,
  TAB_ACTIVE,
  TAB_BASE,
  TAB_INACTIVE,
} from "@/components/platform-shared";
import type { PlatformProject } from "@/components/platform-shared";

export const Route = createFileRoute("/_layout/_authenticated/_superadmin/admin/platform/")({
  head: () => ({
    meta: [{ title: "Organizations | Platform" }],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    prefillSlug: typeof search.prefillSlug === "string" ? search.prefillSlug : undefined,
    prefillDaoAccountId:
      typeof search.prefillDaoAccountId === "string" ? search.prefillDaoAccountId : undefined,
  }),
  component: PlatformOrganizationsPage,
});

type Member = {
  id: string;
  userId: string;
  nearAccountId: string | null;
  role: string;
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  contributor: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  client: "bg-green-500/10 text-green-600 border-green-500/20",
};

function PlatformOrganizationsPage() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { prefillSlug, prefillDaoAccountId } = useSearch({
    from: "/_layout/_authenticated/_superadmin/admin/platform/",
  });
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [confirmDeleteOrgId, setConfirmDeleteOrgId] = useState<string | null>(null);

  useEffect(() => {
    if (prefillSlug || prefillDaoAccountId) setShowCreateOrg(true);
  }, [prefillSlug, prefillDaoAccountId]);

  const orgsQuery = useQuery({
    queryKey: ["platform", "orgs"],
    queryFn: () => apiClient.platform.listOrgs(),
  });

  const deleteOrgMutation = useMutation({
    mutationFn: (orgId: string) => apiClient.platform.deleteOrg({ orgId }),
    onSuccess: () => {
      toast.success("Organization deleted");
      queryClient.invalidateQueries({ queryKey: ["platform", "orgs"] });
      queryClient.invalidateQueries({ queryKey: ["platform", "projects"] });
      setConfirmDeleteOrgId(null);
      setEditingOrgId(null);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to delete organization"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          all organizations
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowCreateOrg((v) => !v)}>
          {showCreateOrg ? "cancel" : "+ new org"}
        </Button>
      </div>

      {showCreateOrg && (
        <OrgForm
          initialSlug={prefillSlug}
          initialDaoAccountId={prefillDaoAccountId}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ["platform", "orgs"] });
            queryClient.invalidateQueries({ queryKey: ["platform", "projects"] });
            setShowCreateOrg(false);
          }}
        />
      )}

      {orgsQuery.isLoading && <Spinner />}

      {orgsQuery.data?.length === 0 && (
        <p className="font-mono text-sm text-muted-foreground">No organizations yet.</p>
      )}

      <div className="space-y-2">
        {orgsQuery.data?.map((org) => (
          <div key={org.id} className="space-y-0">
            <Card>
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="space-y-0.5 min-w-0">
                  <div className="font-display text-base uppercase tracking-tight font-bold">
                    {org.name}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">@{org.slug}</div>
                  {(org.metadata as { daoAccountId?: string })?.daoAccountId && (
                    <div className="font-mono text-[10px] text-muted-foreground break-all">
                      dao: {String((org.metadata as { daoAccountId?: string }).daoAccountId)}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingOrgId(editingOrgId === org.id ? null : org.id)}
                  >
                    {editingOrgId === org.id ? "cancel" : "edit"}
                  </Button>
                  {confirmDeleteOrgId === org.id ? (
                    <>
                      <span className="font-mono text-[11px] text-destructive">sure?</span>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => deleteOrgMutation.mutate(org.id)}
                        disabled={deleteOrgMutation.isPending}
                      >
                        {deleteOrgMutation.isPending ? "…" : "yes, delete"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmDeleteOrgId(null)}
                        disabled={deleteOrgMutation.isPending}
                      >
                        cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setConfirmDeleteOrgId(org.id)}
                    >
                      delete
                    </Button>
                  )}
                  <a href={orgSiteUrl(org.slug)} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline">
                      view org →
                    </Button>
                  </a>
                </div>
              </CardContent>
            </Card>
            {editingOrgId === org.id && (
              <OrgForm
                org={{ ...org, slug: org.slug ?? "" }}
                onDone={() => {
                  queryClient.invalidateQueries({ queryKey: ["platform", "orgs"] });
                  queryClient.invalidateQueries({ queryKey: ["platform", "projects"] });
                  setEditingOrgId(null);
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function OrgProjectsTab({ orgId }: { orgId: string }) {
  const apiClient = useApiClient();
  const projectsQuery = useQuery({
    queryKey: ["platform", "projects"],
    queryFn: () => apiClient.platform.listProjects(),
  });

  if (projectsQuery.isLoading) return <Spinner />;

  const org = projectsQuery.data?.orgs.find((entry) => entry.id === orgId);
  const projects = org?.projects ?? [];

  return (
    <div className="space-y-3">
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        {projects.length} project{projects.length === 1 ? "" : "s"}
      </div>

      {projects.length === 0 ? (
        <p className="font-mono text-sm text-muted-foreground">No projects in this org yet.</p>
      ) : (
        <div className="space-y-2">
          {projects.map((project: PlatformProject) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrgMembersTab({
  orgId,
  onMembersChanged,
}: {
  orgId: string;
  onMembersChanged: () => void;
}) {
  const apiClient = useApiClient();
  type OrgRole = "admin" | "contributor" | "client";

  const membersQuery = useQuery({
    queryKey: ["platform", "orgs", orgId, "members"],
    queryFn: () => apiClient.platform.listOrgMembers({ orgId }),
  });

  const [pendingRoles, setPendingRoles] = useState<Record<string, OrgRole>>({});

  useEffect(() => {
    if (!membersQuery.data) return;
    setPendingRoles(
      Object.fromEntries(
        membersQuery.data.map((member) => [member.id, member.role as OrgRole]),
      ) as Record<string, OrgRole>,
    );
  }, [membersQuery.data]);

  const dirtyMembers =
    membersQuery.data?.filter((member) => pendingRoles[member.id] !== member.role) ?? [];

  const saveMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(
        dirtyMembers.map((member) =>
          apiClient.platform.updateOrgMember({
            orgId,
            memberId: member.id,
            role: pendingRoles[member.id],
          }),
        ),
      );
    },
    onSuccess: () => {
      toast.success("Member roles updated");
      onMembersChanged();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to update member roles"),
  });

  if (membersQuery.isLoading) return <Spinner />;

  const members = membersQuery.data ?? [];

  return (
    <div className="space-y-6">
      <AddMemberForm orgId={orgId} onAdded={onMembersChanged} />

      {members.length === 0 ? (
        <p className="font-mono text-sm text-muted-foreground">No members yet.</p>
      ) : (
        <div className="space-y-2">
          {members.map((member) => (
            <PlatformMemberRow
              key={member.id}
              member={member}
              pendingRole={pendingRoles[member.id] ?? (member.role as OrgRole)}
              onPendingRoleChange={(role) =>
                setPendingRoles((current) => ({ ...current, [member.id]: role }))
              }
              onRemoved={onMembersChanged}
              orgId={orgId}
            />
          ))}
        </div>
      )}

      <Button
        onClick={() => saveMutation.mutate()}
        disabled={dirtyMembers.length === 0 || saveMutation.isPending}
        className="font-display uppercase tracking-wide"
      >
        {saveMutation.isPending ? "saving…" : "save changes →"}
      </Button>
    </div>
  );
}

function OrgForm({
  org,
  onDone,
  initialSlug,
  initialDaoAccountId,
}: {
  org?: { id: string; name: string; slug: string; metadata: Record<string, unknown> | null };
  onDone: () => void;
  initialSlug?: string;
  initialDaoAccountId?: string;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const isEdit = !!org;
  const [editTab, setEditTab] = useState<"details" | "members" | "projects">("details");

  const [name, setName] = useState(org?.name ?? "");
  const [slug, setSlug] = useState(org?.slug ?? initialSlug ?? "");
  const [daoAccountId, setDaoAccountId] = useState(
    String((org?.metadata as { daoAccountId?: string })?.daoAccountId ?? initialDaoAccountId ?? ""),
  );
  const [adminNearId, setAdminNearId] = useState("");

  const slugFromName = (n: string) =>
    n
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");

  const mutation = useMutation({
    mutationFn: () =>
      isEdit
        ? apiClient.platform.updateOrg({
            orgId: org.id,
            name: name.trim() || undefined,
            daoAccountId: daoAccountId.trim() || undefined,
          })
        : apiClient.platform.createOrg({
            name: name.trim(),
            slug: slug.trim(),
            daoAccountId: daoAccountId.trim(),
            adminNearId: adminNearId.trim(),
          }),
    onSuccess: (result) => {
      toast.success(
        isEdit
          ? "Organization updated"
          : `Organization "${(result as { name: string }).name}" created`,
      );
      onDone();
    },
    onError: (e: Error) =>
      toast.error(e.message || (isEdit ? "Failed to update" : "Failed to create")),
  });

  const canSubmit =
    name.trim().length > 0 &&
    (isEdit ||
      (slug.trim().length > 0 &&
        daoAccountId.trim().length > 0 &&
        adminNearId.trim().length > 0)) &&
    !mutation.isPending;

  const detailsFields = (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1">
        <label htmlFor="org-name" className={LABEL_CLS}>
          name
        </label>
        <Input
          id="org-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!isEdit && (!slug || slug === slugFromName(name)))
              setSlug(slugFromName(e.target.value));
          }}
          placeholder="Acme Agency"
          disabled={mutation.isPending}
        />
      </div>
      {!isEdit && (
        <div className="space-y-1">
          <label htmlFor="org-slug" className={LABEL_CLS}>
            slug
          </label>
          <Input
            id="org-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="acme-agency"
            disabled={mutation.isPending}
          />
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor="org-dao-account" className={LABEL_CLS}>
          sputnik dao account
        </label>
        <Input
          id="org-dao-account"
          value={daoAccountId}
          onChange={(e) => setDaoAccountId(e.target.value)}
          placeholder="acme.sputnik-dao.near"
          disabled={mutation.isPending}
        />
      </div>
      {!isEdit && (
        <div className="space-y-1">
          <label htmlFor="org-admin-near-id" className={LABEL_CLS}>
            org admin near id
          </label>
          <Input
            id="org-admin-near-id"
            value={adminNearId}
            onChange={(e) => setAdminNearId(e.target.value)}
            placeholder="alice.near"
            disabled={mutation.isPending}
          />
        </div>
      )}
    </div>
  );

  return (
    <Card className={isEdit ? "rounded-t-none border-t-0" : ""}>
      <CardContent className="p-5 space-y-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {isEdit ? "edit organization" : "create organization"}
        </div>

        {isEdit ? (
          <div className="space-y-6">
            <nav className="flex items-center gap-1 border-b border-border pb-px">
              {(["details", "members", "projects"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setEditTab(tab)}
                  className={`${TAB_BASE} ${editTab === tab ? TAB_ACTIVE : TAB_INACTIVE}`}
                >
                  {tab}
                </button>
              ))}
            </nav>

            {editTab === "details" && (
              <div className="space-y-6">
                {detailsFields}
                <Button
                  onClick={() => mutation.mutate()}
                  disabled={!canSubmit}
                  className="font-display uppercase tracking-wide"
                >
                  {mutation.isPending ? "saving…" : "save changes →"}
                </Button>
              </div>
            )}

            {editTab === "members" && (
              <OrgMembersTab
                orgId={org.id}
                onMembersChanged={() =>
                  queryClient.invalidateQueries({
                    queryKey: ["platform", "orgs", org.id, "members"],
                  })
                }
              />
            )}

            {editTab === "projects" && <OrgProjectsTab orgId={org.id} />}
          </div>
        ) : (
          <>
            {detailsFields}
            <Button
              onClick={() => mutation.mutate()}
              disabled={!canSubmit}
              className="font-display uppercase tracking-wide"
            >
              {mutation.isPending ? "creating…" : "create org →"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AddMemberForm({ orgId, onAdded }: { orgId: string; onAdded: () => void }) {
  const apiClient = useApiClient();
  const [nearAccountId, setNearAccountId] = useState("");
  const [role, setRole] = useState<"admin" | "contributor" | "client">("contributor");

  const addMutation = useMutation({
    mutationFn: () =>
      apiClient.platform.addOrgMember({ orgId, nearAccountId: nearAccountId.trim(), role }),
    onSuccess: () => {
      toast.success(`Added ${nearAccountId}`);
      setNearAccountId("");
      onAdded();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to add member"),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="add-org-member-near-id" className={LABEL_CLS}>
            near account id
          </label>
          <Input
            id="add-org-member-near-id"
            value={nearAccountId}
            onChange={(e) => setNearAccountId(e.target.value)}
            placeholder="alice.near"
            disabled={addMutation.isPending}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="add-org-member-role" className={LABEL_CLS}>
            role
          </label>
          <select
            id="add-org-member-role"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            disabled={addMutation.isPending}
            className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 font-mono text-xs"
          >
            <option value="admin">admin</option>
            <option value="contributor">contributor</option>
            <option value="client">client</option>
          </select>
        </div>
      </div>
      <Button
        onClick={() => addMutation.mutate()}
        disabled={!nearAccountId.trim() || addMutation.isPending}
        className="font-display uppercase tracking-wide"
      >
        {addMutation.isPending ? "adding…" : "add member →"}
      </Button>
    </div>
  );
}

function PlatformMemberRow({
  member,
  orgId,
  pendingRole,
  onPendingRoleChange,
  onRemoved,
}: {
  member: Member;
  orgId: string;
  pendingRole: "admin" | "contributor" | "client";
  onPendingRoleChange: (role: "admin" | "contributor" | "client") => void;
  onRemoved: () => void;
}) {
  const apiClient = useApiClient();

  const removeMutation = useMutation({
    mutationFn: () => apiClient.platform.removeOrgMember({ orgId, memberId: member.id }),
    onSuccess: () => {
      toast.success("Member removed");
      onRemoved();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to remove member"),
  });

  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-sm truncate">{member.nearAccountId ?? member.userId}</div>
        </div>
        <span
          className={`font-mono text-[10px] uppercase px-2 py-0.5 rounded-sm border ${ROLE_COLORS[member.role] ?? ""}`}
        >
          {member.role}
        </span>
        <select
          value={pendingRole}
          onChange={(e) => onPendingRoleChange(e.target.value as typeof pendingRole)}
          disabled={removeMutation.isPending}
          className="h-7 rounded border border-input bg-background px-2 font-mono text-[11px]"
        >
          <option value="admin">admin</option>
          <option value="contributor">contributor</option>
          <option value="client">client</option>
        </select>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => removeMutation.mutate()}
          disabled={removeMutation.isPending}
        >
          {removeMutation.isPending ? "…" : "remove"}
        </Button>
      </CardContent>
    </Card>
  );
}
