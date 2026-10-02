import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { ORPCError, oc } from "every-plugin/orpc";
import { z } from "every-plugin/zod";

export const communityContract = oc.router({
  listProjects: oc
    .route({ method: "GET", path: "/v1/projects" })
    .input(
      z.object({
        kind: z.enum(["project", "idea", "scope", "result"]).optional(),
        visibility: z.enum(["private", "unlisted", "public"]).optional(),
        status: z.enum(["active", "paused", "archived"]).optional(),
        query: z.string().max(200).optional(),
        sort: z.enum(["newest", "oldest"]).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      }),
    )
    .output(
      z.object({
        data: z.array(
          z.object({
            id: z.string(),
            ownerId: z.string(),
            slug: z.string(),
            title: z.string(),
            description: z.string().nullable(),
            repository: z.string().nullable(),
            domain: z.string().nullable(),
          }),
        ),
        meta: z.object({
          total: z.number(),
          hasMore: z.boolean(),
          nextCursor: z.string().nullable(),
        }),
      }),
    ),
});

export type CommunityProject = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  repository: string | null;
  domain: string | null;
  ownerId: string;
};

function trimSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

export function createCommunityService(apiUrl: string) {
  const base = trimSlashes(apiUrl);
  const origin = new URL(base).origin;
  const client: ContractRouterClient<typeof communityContract> = createORPCClient(
    new RPCLink({ url: `${base}/rpc` }),
  );

  return {
    searchProjects: async (input: { query?: string; cursor?: string }) => {
      const page = await client
        .listProjects({
          kind: "project",
          visibility: "public",
          status: "active",
          query: input.query?.trim() || undefined,
          sort: "newest",
          limit: 24,
          cursor: input.cursor,
        })
        .catch((err: unknown) => {
          throw new ORPCError("SERVICE_UNAVAILABLE", {
            message: `Could not reach ${new URL(base).host}`,
            cause: err,
          });
        });
      return {
        source: { name: new URL(base).host, url: origin },
        data: page.data.map(
          (p): CommunityProject => ({
            id: p.id,
            slug: p.slug,
            title: p.title,
            description: p.description ?? null,
            repository: p.repository ?? null,
            domain: p.domain ?? null,
            ownerId: p.ownerId,
          }),
        ),
        nextCursor: page.meta.nextCursor ?? null,
      };
    },
  };
}

export type CommunityService = ReturnType<typeof createCommunityService>;
