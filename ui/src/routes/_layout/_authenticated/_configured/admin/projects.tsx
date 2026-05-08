import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, Input } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty, Field, Loading, selectClass, textareaClass } from "@/components/admin-form";
import { formatTokenAmount } from "@/lib/format-amount";
import { nearnListingUrl } from "@/lib/nearn";
import { useApiClient } from "@/lib/use-api-client";

export const Route = createFileRoute("/_layout/_authenticated/_configured/admin/projects")({
  head: () => ({
    meta: [{ title: "Admin · Projects" }],
  }),
  component: AdminProjects,
});

type ProjectStatus = "active" | "paused" | "archived";
type Visibility = "public" | "private";

type Project = {
  id: string;
  ownerId: string;
  organizationId: string | null;
  slug: string;
  title: string;
  description: string | null;
  nearnListingId: string | null;
  status: ProjectStatus;
  visibility: Visibility;
};

function AdminProjects() {
  const apiClient = useApiClient();
  const projectsQuery = useQuery({
    queryKey: ["admin", "projects", "list"],
    queryFn: () => apiClient.projects.adminList(),
    retry: false,
  });

  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{
    nearnListingId: string;
    title: string;
    slug: string;
  } | null>(null);

  if (projectsQuery.isError) {
    return <AdminError error={projectsQuery.error} />;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Create projects, edit their details, and assign contributors.
          </p>
        </div>
        <Button onClick={() => setCreating((v) => !v)} variant={creating ? "outline" : "default"}>
          {creating ? "cancel" : "+ new project"}
        </Button>
      </header>

      {creating && (
        <ProjectCreateForm
          onDone={() => {
            setCreating(false);
            setPrefill(null);
          }}
          initialNearnListingId={prefill?.nearnListingId}
          initialTitle={prefill?.title}
          initialSlug={prefill?.slug}
        />
      )}

      {projectsQuery.isLoading ? (
        <Loading label="Loading projects..." />
      ) : projectsQuery.data && projectsQuery.data.data.length > 0 ? (
        <div className="space-y-3">
          {projectsQuery.data.data.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              expanded={selectedId === p.id}
              onToggle={() => setSelectedId((s) => (s === p.id ? null : p.id))}
            />
          ))}
        </div>
      ) : (
        <Empty label="No projects yet. Create your first one above." />
      )}

      <NearnSponsorBountiesPanel
        linkedSlugs={
          new Set(
            (projectsQuery.data?.data ?? [])
              .map((p) => p.nearnListingId)
              .filter((s): s is string => !!s),
          )
        }
        onCreateFrom={(b) => {
          setPrefill({
            nearnListingId: b.slug,
            title: b.title ?? "",
            slug: b.slug,
          });
          setCreating(true);
        }}
      />
    </div>
  );
}

function ProjectRow({
  project,
  expanded,
  onToggle,
}: {
  project: Project;
  expanded: boolean;
  onToggle: () => void;
}) {
  const apiClient = useApiClient();
  const budgetQuery = useQuery({
    queryKey: ["admin", "projects", "budget", project.id],
    queryFn: () => apiClient.projects.getBudget({ projectId: project.id }),
    staleTime: 30_000,
  });
  const fundingBadge = formatFundingBadge(budgetQuery.data?.budgets);

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <button type="button" onClick={onToggle} className="space-y-1 min-w-0 text-left flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={project.status === "active" ? "default" : "outline"}>
                {project.status}
              </Badge>
              <Badge variant="outline">{project.visibility}</Badge>
              {fundingBadge && (
                <Badge variant={fundingBadge.tone === "destructive" ? "destructive" : "outline"}>
                  {fundingBadge.label}
                </Badge>
              )}
            </div>
            <div className="font-semibold tracking-tight break-all">{project.title}</div>
            <div className="text-xs font-mono text-muted-foreground">@{project.slug}</div>
          </button>
          <div className="flex items-center gap-2 shrink-0">
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/projects/$slug" params={{ slug: project.slug }}>
                manage
              </Link>
            </Button>
            <button
              type="button"
              onClick={onToggle}
              className="text-xs text-muted-foreground font-mono px-2"
              aria-label={expanded ? "collapse" : "expand"}
            >
              {expanded ? "−" : "+"}
            </button>
          </div>
        </div>

        {expanded && (
          <div className="space-y-6 pt-2 border-t border-border">
            {project.nearnListingId && <NearnSnapshot slug={project.nearnListingId} />}
            <ProjectEditForm project={project} />
            <AssignmentsSection projectId={project.id} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type TokenBudgetRow = {
  tokenId: string;
  budget: string;
  remaining: string;
};

function formatFundingBadge(
  budgets: TokenBudgetRow[] | undefined,
): { label: string; tone: "default" | "destructive" } | null {
  if (!budgets || budgets.length === 0) return { label: "no budget", tone: "default" };
  const nonZero = budgets.filter((b) => BigInt(b.budget) !== 0n);
  if (nonZero.length === 0) return { label: "no budget", tone: "default" };
  const top = nonZero.reduce((acc, b) => (BigInt(b.budget) > BigInt(acc.budget) ? b : acc));
  const remaining = BigInt(top.remaining);
  if (remaining < 0n) {
    return {
      label: `over-allocated ${formatTokenAmount((-remaining).toString(), top.tokenId)}`,
      tone: "destructive",
    };
  }
  return {
    label: `funded · ${formatTokenAmount(top.remaining, top.tokenId)} remaining`,
    tone: "default",
  };
}

function ProjectCreateForm({
  onDone,
  initialNearnListingId,
  initialTitle,
  initialSlug,
}: {
  onDone: () => void;
  initialNearnListingId?: string;
  initialTitle?: string;
  initialSlug?: string;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [slug, setSlug] = useState(initialSlug ?? "");
  const [title, setTitle] = useState(initialTitle ?? "");
  const [description, setDescription] = useState("");
  const [nearnListingId, setNearnListingId] = useState(initialNearnListingId ?? "");
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [vis, setVis] = useState<Visibility>("private");

  const createMutation = useMutation({
    mutationFn: async () =>
      apiClient.projects.adminCreate({
        slug: slug.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        nearnListingId: nearnListingId.trim() || undefined,
        status,
        visibility: vis,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "projects", "list"] });
      toast.success("Project created");
      onDone();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to create project"),
  });

  const isPending = createMutation.isPending;
  const canSubmit = slug.trim().length > 0 && title.trim().length > 0 && !isPending;

  return (
    <Card>
      <CardContent className="p-5 grid gap-4">
        <Field label="slug" htmlFor="new-slug">
          <Input
            id="new-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="lowercase-with-hyphens"
            disabled={isPending}
          />
        </Field>
        <Field label="title" htmlFor="new-title">
          <Input
            id="new-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isPending}
          />
        </Field>
        <Field label="notes" htmlFor="new-description">
          <textarea
            id="new-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            disabled={isPending}
            className={textareaClass}
          />
        </Field>
        <Field label="nearn listing slug (optional)" htmlFor="new-nearn-listing">
          <Input
            id="new-nearn-listing"
            value={nearnListingId}
            onChange={(e) => setNearnListingId(e.target.value)}
            placeholder="e.g. my-bounty-slug"
            disabled={isPending}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="status" htmlFor="new-status">
            <select
              id="new-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
              disabled={isPending}
              className={selectClass}
            >
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="archived">archived</option>
            </select>
          </Field>
          <Field label="visibility" htmlFor="new-vis">
            <select
              id="new-vis"
              value={vis}
              onChange={(e) => setVis(e.target.value as Visibility)}
              disabled={isPending}
              className={selectClass}
            >
              <option value="private">private</option>
              <option value="public">public</option>
            </select>
          </Field>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => createMutation.mutate()} disabled={!canSubmit}>
            {isPending ? "creating..." : "create project"}
          </Button>
          <Button onClick={onDone} variant="outline" disabled={isPending}>
            cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectEditForm({ project }: { project: Project }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description ?? "");
  const [nearnListingId, setNearnListingId] = useState(project.nearnListingId ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [vis, setVis] = useState<Visibility>(project.visibility);

  useEffect(() => {
    setTitle(project.title);
    setDescription(project.description ?? "");
    setNearnListingId(project.nearnListingId ?? "");
    setStatus(project.status);
    setVis(project.visibility);
  }, [project]);

  const updateMutation = useMutation({
    mutationFn: async () =>
      apiClient.projects.adminUpdate({
        id: project.id,
        title: title.trim(),
        description: description.trim() || null,
        nearnListingId: nearnListingId.trim() || null,
        status,
        visibility: vis,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "projects", "list"] });
      toast.success("Project updated");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to update project"),
  });

  const isPending = updateMutation.isPending;
  const canSubmit = title.trim().length > 0 && !isPending;

  return (
    <div className="grid gap-4">
      <h3 className="font-semibold tracking-tight">Edit</h3>
      <Field label="title" htmlFor={`edit-title-${project.id}`}>
        <Input
          id={`edit-title-${project.id}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isPending}
        />
      </Field>
      <Field label="notes" htmlFor={`edit-desc-${project.id}`}>
        <textarea
          id={`edit-desc-${project.id}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          disabled={isPending}
          className={textareaClass}
        />
      </Field>
      <Field label="nearn listing slug" htmlFor={`edit-nearn-${project.id}`}>
        <Input
          id={`edit-nearn-${project.id}`}
          value={nearnListingId}
          onChange={(e) => setNearnListingId(e.target.value)}
          placeholder="e.g. my-bounty-slug"
          disabled={isPending}
        />
        {nearnListingId.trim() && (
          <a
            href={nearnListingUrl(nearnListingId.trim())}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-muted-foreground hover:text-foreground underline break-all"
          >
            view on nearn ↗
          </a>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="status" htmlFor={`edit-status-${project.id}`}>
          <select
            id={`edit-status-${project.id}`}
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            disabled={isPending}
            className={selectClass}
          >
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="archived">archived</option>
          </select>
        </Field>
        <Field label="visibility" htmlFor={`edit-vis-${project.id}`}>
          <select
            id={`edit-vis-${project.id}`}
            value={vis}
            onChange={(e) => setVis(e.target.value as Visibility)}
            disabled={isPending}
            className={selectClass}
          >
            <option value="private">private</option>
            <option value="public">public</option>
          </select>
        </Field>
      </div>
      <div>
        <Button onClick={() => updateMutation.mutate()} disabled={!canSubmit} size="sm">
          {isPending ? "saving..." : "save changes"}
        </Button>
      </div>
    </div>
  );
}

function AssignmentsSection({ projectId }: { projectId: string }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const assignmentsQuery = useQuery({
    queryKey: ["admin", "assignments", projectId],
    queryFn: () => apiClient.assignments.adminList({ projectId }),
  });
  const contributorsQuery = useQuery({
    queryKey: ["admin", "contributors", "list"],
    queryFn: () => apiClient.contributors.adminList(),
  });

  const [contributorId, setContributorId] = useState("");
  const [role, setRole] = useState("");

  const addMutation = useMutation({
    mutationFn: async () =>
      apiClient.assignments.adminCreate({
        projectId,
        contributorId,
        role: role.trim() || undefined,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "assignments", projectId] });
      setContributorId("");
      setRole("");
      toast.success("Contributor assigned");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to assign contributor"),
  });

  const removeMutation = useMutation({
    mutationFn: async (cid: string) =>
      apiClient.assignments.adminDelete({ projectId, contributorId: cid }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "assignments", projectId] });
      toast.success("Contributor unassigned");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to unassign contributor"),
  });

  const assigned = assignmentsQuery.data?.data ?? [];
  const allContributors = contributorsQuery.data?.data ?? [];
  const assignedIds = new Set(assigned.map((a) => a.contributorId));
  const available = allContributors.filter((c) => !assignedIds.has(c.id));

  return (
    <div className="space-y-3">
      <h3 className="font-semibold tracking-tight">Contributors</h3>
      {assigned.length === 0 ? (
        <p className="text-xs text-muted-foreground">No contributors assigned.</p>
      ) : (
        <div className="space-y-2">
          {assigned.map((a) => (
            <div
              key={a.contributorId}
              className="rounded-sm border border-border bg-muted/10 p-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">{a.contributor.name}</div>
                <div className="text-xs text-muted-foreground">
                  {a.role ?? "—"}
                  {a.contributor.nearAccountId && (
                    <span className="ml-2 font-mono">{a.contributor.nearAccountId}</span>
                  )}
                </div>
              </div>
              <Button
                onClick={() => removeMutation.mutate(a.contributorId)}
                disabled={removeMutation.isPending}
                variant="outline"
                size="sm"
              >
                remove
              </Button>
            </div>
          ))}
        </div>
      )}

      {available.length > 0 ? (
        <div className="rounded-sm border border-border bg-muted/10 p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select
              value={contributorId}
              onChange={(e) => setContributorId(e.target.value)}
              disabled={addMutation.isPending}
              className={selectClass}
            >
              <option value="">— pick contributor —</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="role (optional)"
              disabled={addMutation.isPending}
            />
            <Button
              onClick={() => addMutation.mutate()}
              disabled={!contributorId || addMutation.isPending}
              size="sm"
            >
              {addMutation.isPending ? "adding..." : "assign"}
            </Button>
          </div>
        </div>
      ) : (
        allContributors.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No contributors yet. Create some on{" "}
            <Link to="/admin/contributors" className="underline">
              the contributors page
            </Link>
            .
          </p>
        )
      )}
    </div>
  );
}

function NearnSnapshot({ slug }: { slug: string }) {
  const apiClient = useApiClient();
  const listingQuery = useQuery({
    queryKey: ["admin", "nearn", "listing", slug],
    queryFn: () => apiClient.nearn.getListing({ slug }),
    retry: false,
    staleTime: 60_000,
  });

  if (listingQuery.isLoading) {
    return (
      <div className="rounded-sm border border-dashed border-border p-3 text-xs text-muted-foreground">
        Loading NEARN listing snapshot…
      </div>
    );
  }
  if (listingQuery.isError) {
    return (
      <div className="rounded-sm border border-dashed border-destructive/60 p-3 text-xs text-destructive">
        NEARN listing not reachable for slug "{slug}". Check the slug or try later.
      </div>
    );
  }
  const l = listingQuery.data?.listing;
  if (!l) return null;
  return (
    <div className="rounded-sm border border-border bg-muted/10 p-3 space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">NEARN snapshot</Badge>
        {l.status && <Badge variant="default">{l.status}</Badge>}
        {l.type && <Badge variant="outline">{l.type}</Badge>}
      </div>
      {l.title && <div className="text-sm font-medium">{l.title}</div>}
      {l.rewardAmount !== null && l.token && (
        <div className="font-mono text-muted-foreground">
          reward: {l.rewardAmount} {l.token}
        </div>
      )}
      {l.deadline && (
        <div className="text-muted-foreground">
          deadline: {new Date(l.deadline).toISOString().slice(0, 10)}
        </div>
      )}
      <a
        href={nearnListingUrl(l.slug)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground hover:text-foreground underline break-all"
      >
        view on nearn ↗
      </a>
    </div>
  );
}

function NearnSponsorBountiesPanel({
  linkedSlugs,
  onCreateFrom,
}: {
  linkedSlugs: Set<string>;
  onCreateFrom: (b: { slug: string; title: string | null }) => void;
}) {
  const apiClient = useApiClient();
  const query = useQuery({
    queryKey: ["admin", "nearn", "sponsor-bounties"],
    queryFn: () => apiClient.nearn.listSponsorBounties(),
    retry: false,
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          Checking NEARN for unlinked bounties…
        </CardContent>
      </Card>
    );
  }
  if (query.isError) {
    return null;
  }
  const data = query.data;
  if (!data) return null;
  if (!data.sponsorSlug) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          No NEARN sponsor configured. Set <span className="font-mono">nearnAccountId</span> on the{" "}
          <Link to="/settings" className="underline">
            settings page
          </Link>{" "}
          to surface unlinked NEARN bounties here.
        </CardContent>
      </Card>
    );
  }
  const unlinked = data.bounties.filter((b) => !linkedSlugs.has(b.slug));
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">Unlinked NEARN bounties</h2>
      <p className="text-sm text-muted-foreground max-w-2xl">
        Active NEARN bounties for <span className="font-mono">@{data.sponsorSlug}</span> not yet
        linked to a project here.
      </p>
      {unlinked.length === 0 ? (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">
            All current NEARN bounties are linked.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {unlinked.map((b) => (
            <div
              key={b.slug}
              className="rounded-sm border border-border bg-muted/10 p-3 flex items-start justify-between gap-3 flex-wrap"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {b.status && <Badge variant="default">{b.status}</Badge>}
                  {b.type && <Badge variant="outline">{b.type}</Badge>}
                </div>
                <div className="text-sm font-medium">{b.title ?? b.slug}</div>
                <div className="text-xs font-mono text-muted-foreground">@{b.slug}</div>
                {b.rewardAmount !== null && b.token && (
                  <div className="text-xs font-mono text-muted-foreground">
                    reward: {b.rewardAmount} {b.token}
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onCreateFrom({ slug: b.slug, title: b.title })}
              >
                + create project
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
