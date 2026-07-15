import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { Badge, Button, Card, CardContent, DataTable, Empty, EmptyTitle } from "@/components";
import { AssignmentsSection } from "@/components/admin/assignments-section";
import { type Project, ProjectForm } from "@/components/admin/project-form";
import { AdminError } from "@/components/admin-error";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import { formatNearnReward, nearnListingHref } from "@/lib/nearn";
import { adminProjectsListQueryOptions, publicSettingsQueryOptions } from "@/lib/queries";

type AdminProject = Awaited<ReturnType<ApiClient["agency"]["projects"]["list"]>>["data"][number];

export function ProjectsAdminSection() {
  const apiClient = useApiClient();
  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));
  const settingsQuery = useQuery(publicSettingsQueryOptions(apiClient));
  const nearnSponsor = settingsQuery.data?.nearnAccountId ?? null;
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

  const selected = projectsQuery.data?.data.find((p) => p.id === selectedId);

  const columns: ColumnDef<AdminProject>[] = [
    {
      id: "title",
      header: "Title",
      accessorKey: "title",
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <div className="font-display text-sm uppercase tracking-tight font-bold">
            {row.original.title}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">@{row.original.slug}</div>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      cell: ({ row }) => (
        <Badge variant={row.original.status === "active" ? "default" : "outline"}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      id: "visibility",
      header: "Visibility",
      accessorKey: "visibility",
      cell: ({ row }) => <Badge variant="outline">{row.original.visibility}</Badge>,
    },
    {
      id: "nearn",
      header: "NEARN",
      accessorFn: (row) => row.nearnListing?.slug ?? "",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.nearnListing?.slug ?? "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex gap-2 justify-end">
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/projects/$slug" params={{ slug: row.original.slug }}>
              manage
            </Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedId((s) => (s === row.original.id ? null : row.original.id))}
          >
            {selectedId === row.original.id ? "close" : "edit"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-end gap-3">
        <Button
          onClick={() => {
            setCreating((v) => !v);
            setPrefill(null);
          }}
          variant={creating ? "outline" : "default"}
          className="font-display uppercase tracking-wide"
        >
          {creating ? "cancel" : "+ new project"}
        </Button>
      </header>

      {creating && (
        <ProjectForm
          key={prefill ? `prefill-${prefill.slug}-${prefill.nearnListingId}` : "create"}
          mode="create"
          defaultValues={
            prefill
              ? {
                  slug: prefill.slug,
                  title: prefill.title,
                  nearnListingId: prefill.nearnListingId,
                  status: "active",
                  visibility: "private",
                }
              : undefined
          }
          onDone={() => {
            setCreating(false);
            setPrefill(null);
          }}
        />
      )}

      <DataTable
        columns={columns}
        data={projectsQuery.data?.data ?? []}
        isLoading={projectsQuery.isLoading}
        error={projectsQuery.error}
        onRetry={() => projectsQuery.refetch()}
        emptyMessage="No projects yet. Create your first one above."
        csvFilename="projects"
        viewId="admin-projects"
        searchPlaceholder="Search projects…"
      />

      {selected && (
        <Card>
          <CardContent className="p-5 space-y-6">
            {selected.nearnListing?.slug && (
              <NearnSnapshot slug={selected.nearnListing.slug} nearnSponsor={nearnSponsor} />
            )}
            <ProjectForm
              key={selected.id}
              mode="edit"
              publicNearnHref={nearnListingHref(selected.nearnListing ?? {}, nearnSponsor)}
              defaultValues={{
                id: selected.id,
                slug: selected.slug,
                title: selected.title,
                repository: selected.repository,
                nearnListingId: selected.nearnListing?.slug ?? "",
                status: selected.status as Project["status"],
                visibility: selected.visibility as Project["visibility"],
              }}
              onDone={() => setSelectedId(null)}
            />
            <AssignmentsSection projectId={selected.id} />
          </CardContent>
        </Card>
      )}

      <NearnSponsorBountiesPanel
        linkedSlugs={
          new Set(
            (projectsQuery.data?.data ?? [])
              .map((p) => p.nearnListing?.slug)
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

function NearnSnapshot({ slug, nearnSponsor }: { slug: string; nearnSponsor: string | null }) {
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
  const href = nearnListingHref(l, nearnSponsor);
  return (
    <div className="rounded-sm border border-border bg-muted/10 p-3 space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">NEARN snapshot</Badge>
        {l.status && <Badge variant="default">{l.status}</Badge>}
        {l.type && <Badge variant="outline">{l.type}</Badge>}
      </div>
      {l.title && <div className="text-sm font-medium">{l.title}</div>}
      <div className="font-mono text-muted-foreground">reward: {formatNearnReward(l)}</div>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground underline break-all"
        >
          {href} ↗
        </a>
      )}
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
  if (query.isError || !query.data) return null;
  if (!query.data.sponsorSlug) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          No NEARN sponsor configured. Set the agency NEARN account in settings to surface unlinked
          bounties here.
        </CardContent>
      </Card>
    );
  }
  const unlinked = query.data.bounties.filter((b) => !linkedSlugs.has(b.slug));
  return (
    <section className="space-y-3 pt-4">
      <div className="space-y-1">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          nearn · sponsor
        </div>
        <h2 className="font-display text-2xl uppercase tracking-tight font-extrabold leading-tight">
          Unlinked Bounties
        </h2>
      </div>
      {unlinked.length === 0 ? (
        <Empty className="border-2 border-dashed border-border/40">
          <EmptyTitle className="font-mono text-sm font-normal text-muted-foreground">
            All current NEARN bounties are linked.
          </EmptyTitle>
        </Empty>
      ) : (
        <div className="space-y-2">
          {unlinked.map((b) => (
            <div
              key={b.slug}
              className="rounded-sm border border-border bg-muted/10 p-3 flex items-start justify-between gap-3 flex-wrap"
            >
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">{b.title ?? b.slug}</div>
                <div className="text-xs font-mono text-muted-foreground">@{b.slug}</div>
                {b.rewardAmount !== null && b.token && (
                  <div className="text-xs font-mono text-muted-foreground">
                    reward: {formatTokenAmount(String(b.rewardAmount), b.token)}
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
