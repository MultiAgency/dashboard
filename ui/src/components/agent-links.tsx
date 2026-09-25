import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, Skeleton } from "@/components";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import { agentLinksListQueryOptions } from "@/lib/queries";
import { safeHttpHref } from "@/lib/url";

export type AgentLinkView = Awaited<ReturnType<ApiClient["agentLinks"]["list"]>>["data"][number];

export function AgentLinkAnchor({ link }: { link: AgentLinkView }) {
  const href = safeHttpHref(link.url);
  if (!href) return <span className="text-sm font-medium">{link.label}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
    >
      {link.label}
      <ArrowSquareOutIcon aria-hidden className="size-3.5 text-muted-foreground" />
    </a>
  );
}

export function AgentLinksCard({ engagementId }: { engagementId: string }) {
  const apiClient = useApiClient();
  const linksQuery = useQuery(agentLinksListQueryOptions(apiClient, engagementId));
  const links = linksQuery.data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardDescription>Agents</CardDescription>
        {linksQuery.isLoading ? (
          <Skeleton className="h-8 w-32" />
        ) : links.length === 0 ? (
          <div className="font-heading text-2xl font-semibold text-muted-foreground">—</div>
        ) : null}
      </CardHeader>
      {links.length > 0 && (
        <CardContent>
          <ul className="flex flex-col gap-1.5">
            {links.map((link) => (
              <li key={link.id}>
                <AgentLinkAnchor link={link} />
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
