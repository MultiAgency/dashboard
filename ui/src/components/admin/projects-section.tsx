import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  DownloadSimpleIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Skeleton,
} from "@/components";
import { CommunityImportPanel } from "@/components/admin/community-import-panel";
import { ProjectForm, type ProjectFormValues } from "@/components/admin/project-form";
import { AdminError } from "@/components/admin-error";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import { formatNearnReward, nearnListingHref } from "@/lib/nearn";
import {
  adminNearnListingQueryOptions,
  adminNearnSponsorBountiesQueryOptions,
  adminProjectsListQueryOptions,
} from "@/lib/queries";
import { isValidSlug, slugify } from "@/lib/slugify";

type AdminProject = Awaited<ReturnType<ApiClient["agency"]["projects"]["list"]>>["data"][number];

export function projectStatusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "active") return "default";
  if (status === "paused") return "secondary";
  return "outline";
}

export function ProjectsAdminSection() {
  const apiClient = useApiClient();
  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [prefill, setPrefill] = useState<Partial<ProjectFormValues> | null>(null);
  const existingSlugs = new Set((projectsQuery.data?.data ?? []).map((p) => p.slug));

  if (projectsQuery.isError) {
    return <AdminError error={projectsQuery.error} />;
  }

  const anyNearnListing = (projectsQuery.data?.data ?? []).some((p) => p.nearnListing);

  const columns: ColumnDef<AdminProject>[] = [
    {
      id: "title",
      header: "Title",
      accessorKey: "title",
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <Link
            to="/admin/projects/$slug"
            params={{ slug: row.original.slug }}
            className="font-medium hover:underline"
          >
            {row.original.title}
          </Link>
          <span className="text-muted-foreground">@{row.original.slug}</span>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      cell: ({ row }) => (
        <Badge variant={projectStatusVariant(row.original.status)}>{row.original.status}</Badge>
      ),
    },
    {
      id: "visibility",
      header: "Visibility",
      accessorKey: "visibility",
      cell: ({ row }) => <Badge variant="outline">{row.original.visibility}</Badge>,
    },
    ...(anyNearnListing
      ? [
          {
            id: "nearn",
            header: "NEARN",
            accessorFn: (row: AdminProject) => row.nearnListing?.slug ?? "",
            cell: ({ row }: { row: { original: AdminProject } }) => (
              <span className="text-muted-foreground">
                {row.original.nearnListing?.slug ?? "—"}
              </span>
            ),
          } satisfies ColumnDef<AdminProject>,
        ]
      : []),
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button asChild size="sm" variant="ghost">
            <Link to="/admin/projects/$slug" params={{ slug: row.original.slug }}>
              Manage
              <ArrowRightIcon data-icon="inline-end" aria-hidden />
            </Link>
          </Button>
        </div>
      ),
    },
  ];

  const startCreate = (next: typeof prefill) => {
    setPrefill(next);
    setImporting(false);
    setCreating(true);
  };

  return (
    <div className="flex flex-col gap-6">
      {creating && (
        <ProjectForm
          key={prefill ? `prefill-${prefill.slug}-${prefill.nearnListingId ?? ""}` : "create"}
          mode="create"
          defaultValues={
            prefill ? { status: "active", visibility: "private", ...prefill } : undefined
          }
          onDone={() => {
            setCreating(false);
            setPrefill(null);
          }}
        />
      )}

      {importing && !creating && (
        <CommunityImportPanel
          existingSlugs={existingSlugs}
          onClose={() => setImporting(false)}
          onImport={(project) =>
            startCreate({
              slug: isValidSlug(project.slug) ? project.slug : slugify(project.title),
              title: project.title,
              description: project.description,
              repository: project.repository,
            })
          }
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Your projects</h2>
          </CardTitle>
          <CardDescription>
            Open a project to manage its builders, budget and billings.
          </CardDescription>
          {!creating && (
            <CardAction className="flex flex-wrap gap-2">
              {!importing && (
                <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
                  <DownloadSimpleIcon data-icon="inline-start" aria-hidden />
                  Import
                </Button>
              )}
              <Button size="sm" onClick={() => startCreate(null)}>
                <PlusIcon data-icon="inline-start" aria-hidden />
                New project
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={projectsQuery.data?.data ?? []}
            isLoading={projectsQuery.isLoading}
            error={projectsQuery.error}
            onRetry={() => projectsQuery.refetch()}
            emptyMessage="No projects yet"
            csvFilename="projects"
            viewId="admin-projects"
            searchPlaceholder="Search projects…"
          />
        </CardContent>
      </Card>

      <NearnSponsorBountiesPanel
        linkedSlugs={
          new Set(
            (projectsQuery.data?.data ?? [])
              .map((p) => p.nearnListing?.slug)
              .filter((s): s is string => !!s),
          )
        }
        onCreateFrom={(b) =>
          startCreate({
            nearnListingId: b.slug,
            title: b.title ?? "",
            slug: b.slug,
          })
        }
      />
    </div>
  );
}

export function NearnSnapshot({
  slug,
  nearnSponsor,
}: {
  slug: string;
  nearnSponsor: string | null;
}) {
  const apiClient = useApiClient();
  const listingQuery = useQuery(adminNearnListingQueryOptions(apiClient, slug));

  if (listingQuery.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }
  if (listingQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>NEARN listing not reachable</AlertTitle>
        <AlertDescription>
          Nothing found for slug “{slug}”. Check the slug or try again later.
        </AlertDescription>
      </Alert>
    );
  }
  const l = listingQuery.data?.listing;
  if (!l) return null;
  const href = nearnListingHref(l, nearnSponsor);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {l.status && <Badge variant="outline">{l.status}</Badge>}
        {l.type && <Badge variant="outline">{l.type}</Badge>}
      </div>
      <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Title</dt>
          <dd className="font-medium break-words">{l.title ?? slug}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs text-muted-foreground">Reward</dt>
          <dd className="font-medium tabular-nums">{formatNearnReward(l)}</dd>
        </div>
      </dl>
      {href && (
        <Button asChild variant="outline" size="sm" className="self-start">
          <a href={href} target="_blank" rel="noopener noreferrer">
            View on NEARN
            <ArrowUpRightIcon data-icon="inline-end" aria-hidden />
          </a>
        </Button>
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
  const query = useQuery(adminNearnSponsorBountiesQueryOptions(apiClient));

  const unlinked = query.data ? query.data.bounties.filter((b) => !linkedSlugs.has(b.slug)) : [];
  if (query.isError || !query.data?.sponsorSlug || unlinked.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Unlinked NEARN bounties</h2>
        </CardTitle>
        <CardDescription>
          Bounties from your NEARN sponsor account that no project tracks yet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ItemGroup>
          {unlinked.map((b) => (
            <Item key={b.slug} variant="outline" size="sm" asChild>
              <li>
                <ItemContent>
                  <ItemTitle>{b.title ?? b.slug}</ItemTitle>
                  <ItemDescription>
                    @{b.slug}
                    {b.rewardAmount !== null &&
                      b.token &&
                      ` · ${formatTokenAmount(String(b.rewardAmount), b.token)}`}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCreateFrom({ slug: b.slug, title: b.title })}
                  >
                    <PlusIcon data-icon="inline-start" aria-hidden />
                    Create project
                  </Button>
                </ItemActions>
              </li>
            </Item>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}
