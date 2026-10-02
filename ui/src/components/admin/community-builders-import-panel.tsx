import { DownloadSimpleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { communityBuildersQueryOptions, refreshAfter } from "@/lib/queries";

type CommunityBuilder = Awaited<
  ReturnType<ApiClient["community"]["searchBuilders"]>
>["data"][number];

function clip(value: string | null, max: number): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function profileOf(builder: CommunityBuilder) {
  return {
    nearAccount: builder.nearAccount,
    name: clip(builder.name, 200),
    bio: clip(builder.bio, 1000),
    location: clip(builder.location, 100),
    skills: builder.skills
      .map((s) => s.trim())
      .filter((s) => s.length > 1)
      .map((s) => s.slice(0, 50))
      .slice(0, 20),
    links: builder.links ?? undefined,
  };
}

export function CommunityBuildersImportPanel({
  existingAccounts,
  onClose,
}: {
  existingAccounts: Set<string>;
  onClose: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const buildersQuery = useQuery(communityBuildersQueryOptions(apiClient, query));
  const source = buildersQuery.data?.source.name ?? "the community";
  const results = buildersQuery.data?.data ?? [];

  const importMutation = useMutation({
    mutationFn: (builder: CommunityBuilder) => apiClient.contributors.create(profileOf(builder)),
    onSuccess: async (_, builder) => {
      await refreshAfter(queryClient, { type: "builders" });
      toast.success(`${builder.name ?? builder.nearAccount} added to your builders`);
    },
    onError: (err: Error) => toast.error(err.message || "Could not import builder"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Import from {source}</h2>
        </CardTitle>
        <CardDescription>
          Add a builder from the community directory. Their name, bio, skills and links are copied
          in; you can edit the profile afterwards.
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
            placeholder="Search community builders…"
            aria-label="Search community builders"
            className="pl-8"
          />
        </div>
        {buildersQuery.isLoading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : buildersQuery.isError ? (
          <AdminError error={buildersQuery.error} />
        ) : results.length === 0 ? (
          <Empty
            icon={<MagnifyingGlassIcon aria-hidden />}
            label={query ? `No builders match “${query}”` : "No community builders found"}
          />
        ) : (
          <ItemGroup>
            {results.map((builder) => {
              const added = existingAccounts.has(builder.nearAccount);
              const pending =
                importMutation.isPending &&
                importMutation.variables?.nearAccount === builder.nearAccount;
              return (
                <li key={builder.nearAccount}>
                  <Item variant="outline" size="sm">
                    <ItemContent className="min-w-0">
                      <ItemTitle className="break-words">
                        {builder.name ?? builder.nearAccount}
                      </ItemTitle>
                      <ItemDescription className="line-clamp-2">
                        {[builder.nearAccount, profileOf(builder).skills.slice(0, 4).join(", ")]
                          .filter(Boolean)
                          .join(" · ")}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={added || pending}
                        onClick={() => importMutation.mutate(builder)}
                      >
                        {!added && <DownloadSimpleIcon data-icon="inline-start" aria-hidden />}
                        {added ? "Already added" : pending ? "Importing…" : "Import"}
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
