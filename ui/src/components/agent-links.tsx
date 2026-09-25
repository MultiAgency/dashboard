import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import { agentLinksListQueryOptions } from "@/lib/queries";
import { safeHttpHref } from "@/lib/url";

export type AgentLinkView = Awaited<ReturnType<ApiClient["agentLinks"]["list"]>>["data"][number];

export function AgentLinkAnchor({ link }: { link: AgentLinkView }) {
  const href = safeHttpHref(link.url);
  if (!href) return <span className="text-sm">{link.label}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm underline">
      {link.label}
    </a>
  );
}

export function AgentLinksCard({ engagementId }: { engagementId: string }) {
  const apiClient = useApiClient();
  const links = useQuery(agentLinksListQueryOptions(apiClient, engagementId)).data?.data ?? [];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase text-muted-foreground">Agents</div>
        {links.length === 0 ? (
          <div className="text-2xl font-black mt-1">—</div>
        ) : (
          <ul className="mt-2 space-y-1">
            {links.map((link) => (
              <li key={link.id}>
                <AgentLinkAnchor link={link} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
