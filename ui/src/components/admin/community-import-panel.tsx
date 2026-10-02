import { DownloadSimpleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Skeleton,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty } from "@/components/admin-form";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import { communityProjectsQueryOptions } from "@/lib/queries";

export type CommunityProject = Awaited<
  ReturnType<ApiClient["community"]["searchProjects"]>
>["data"][number];

export function CommunityImportPanel({
  existingSlugs,
  onImport,
  onClose,
}: {
  existingSlugs: Set<string>;
  onImport: (project: CommunityProject) => void;
  onClose: () => void;
}) {
  const apiClient = useApiClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const projectsQuery = useQuery(communityProjectsQueryOptions(apiClient, query));
  const source = projectsQuery.data?.source.name ?? "the community";
  const results = projectsQuery.data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Import from {source}</h2>
        </CardTitle>
        <CardDescription>
          Start a project from a public listing. Title, description and repository are copied in;
          you can edit them before saving.
        </CardDescription>
        <CardAction>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="relative">
          <MagnifyingGlassIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search community projects…"
            aria-label="Search community projects"
            className="pl-8"
          />
        </div>
        {projectsQuery.isLoading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : projectsQuery.isError ? (
          <AdminError error={projectsQuery.error} />
        ) : results.length === 0 ? (
          <Empty
            icon={<MagnifyingGlassIcon aria-hidden />}
            label={query ? `No projects match “${query}”` : "No public projects found"}
          />
        ) : (
          <ItemGroup>
            {results.map((project) => {
              const added = existingSlugs.has(project.slug);
              return (
                <li key={project.id}>
                  <Item variant="outline" size="sm">
                    <ItemContent className="min-w-0">
                      <ItemTitle className="break-words">{project.title}</ItemTitle>
                      <ItemDescription className="line-clamp-2">
                        {project.description ?? `@${project.slug} · ${project.ownerId}`}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={added}
                        onClick={() => onImport(project)}
                      >
                        {!added && <DownloadSimpleIcon data-icon="inline-start" aria-hidden />}
                        {added ? "Already added" : "Import"}
                      </Button>
                    </ItemActions>
                  </Item>
                </li>
              );
            })}
          </ItemGroup>
        )}
      </CardContent>
    </Card>
  );
}
