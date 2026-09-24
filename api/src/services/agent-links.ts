import { asc, eq, max } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { type AgentLinkRow, agentLinks, type EngagementRow } from "../db/schema";
import {
  badRequest,
  engagementNotFound,
  loadEngagement,
  readableEngagement,
} from "./engagement-lookup";
import type { OrganizationScope } from "./organization-access";

export type AgentLinkView = {
  id: string;
  engagementId: string;
  label: string;
  url: string;
  position: number;
};

const linkNotFound = () => new ORPCError("NOT_FOUND", { message: "Agent link not found" });

function requireHttpUrl(url: string): string {
  const trimmed = url.trim();
  const protocol = URL.canParse(trimmed) ? new URL(trimmed).protocol : null;
  if (protocol !== "http:" && protocol !== "https:") {
    throw badRequest("INVALID_URL", "An agent link must be an http:// or https:// URL.");
  }
  return trimmed;
}

function view(row: AgentLinkRow): AgentLinkView {
  return {
    id: row.id,
    engagementId: row.engagementId,
    label: row.label,
    url: row.url,
    position: row.position,
  };
}

export function createAgentLinksService(deps: { db: Database; now?: () => Date }) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  function requireManageable(scope: OrganizationScope, row: EngagementRow | null) {
    if (!row || row.agencyOrganizationId !== scope.organizationId) throw engagementNotFound();
    if (row.status !== "active") {
      throw badRequest(
        "NOT_ACTIVE",
        "Agent links can only be changed on an active Engagement; an ended one is read-only.",
      );
    }
    return row;
  }

  async function requireLink(scope: OrganizationScope, id: string) {
    const [link] = await db.select().from(agentLinks).where(eq(agentLinks.id, id)).limit(1);
    if (!link) throw linkNotFound();
    const row = await loadEngagement(db, link.engagementId);
    if (row?.agencyOrganizationId !== scope.organizationId) throw linkNotFound();
    requireManageable(scope, row);
    return link;
  }

  async function linksOf(engagementId: string) {
    return db
      .select()
      .from(agentLinks)
      .where(eq(agentLinks.engagementId, engagementId))
      .orderBy(asc(agentLinks.position), asc(agentLinks.createdAt));
  }

  return {
    list: async (scope: OrganizationScope, input: { engagementId: string }) => {
      const { row } = await readableEngagement(db, scope, input.engagementId);
      return { data: (await linksOf(row.id)).map(view) };
    },

    create: async (
      scope: OrganizationScope,
      input: { engagementId: string; label: string; url: string },
    ): Promise<AgentLinkView> => {
      const row = requireManageable(scope, await loadEngagement(db, input.engagementId));
      const url = requireHttpUrl(input.url);
      const [last] = await db
        .select({ position: max(agentLinks.position) })
        .from(agentLinks)
        .where(eq(agentLinks.engagementId, row.id));
      const [created] = await db
        .insert(agentLinks)
        .values({
          id: crypto.randomUUID(),
          engagementId: row.id,
          label: input.label.trim(),
          url,
          position: (last?.position ?? -1) + 1,
        })
        .returning();
      return view(created!);
    },

    update: async (
      scope: OrganizationScope,
      input: { id: string; label?: string; url?: string },
    ): Promise<AgentLinkView> => {
      const link = await requireLink(scope, input.id);
      const [updated] = await db
        .update(agentLinks)
        .set({
          label: input.label?.trim() ?? link.label,
          url: input.url === undefined ? link.url : requireHttpUrl(input.url),
          updatedAt: now(),
        })
        .where(eq(agentLinks.id, link.id))
        .returning();
      return view(updated!);
    },

    reorder: async (scope: OrganizationScope, input: { engagementId: string; ids: string[] }) => {
      const row = requireManageable(scope, await loadEngagement(db, input.engagementId));
      const current = await linksOf(row.id);
      const wanted = new Set(input.ids);
      if (
        wanted.size !== input.ids.length ||
        current.length !== input.ids.length ||
        current.some((l) => !wanted.has(l.id))
      ) {
        throw badRequest("ORDER_MISMATCH", "List every agent link of the Engagement exactly once.");
      }
      await db.transaction(async (tx) => {
        for (const [position, id] of input.ids.entries()) {
          await tx
            .update(agentLinks)
            .set({ position, updatedAt: now() })
            .where(eq(agentLinks.id, id));
        }
      });
      return { data: (await linksOf(row.id)).map(view) };
    },

    remove: async (scope: OrganizationScope, input: { id: string }) => {
      const link = await requireLink(scope, input.id);
      await db.delete(agentLinks).where(eq(agentLinks.id, link.id));
      return { ok: true as const };
    },
  };
}

export type AgentLinksService = ReturnType<typeof createAgentLinksService>;
