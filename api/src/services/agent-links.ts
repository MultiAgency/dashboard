import { asc, eq } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { agentLinks } from "../db/schema";
import type { OrgScope } from "../lib/agency-scope";
import type { EngagementsService } from "./engagements";

function linkUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ORPCError("BAD_REQUEST", { message: "Agent link must be an http(s) URL." });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ORPCError("BAD_REQUEST", { message: "Agent link must be an http(s) URL." });
  }
  return url.toString();
}

export function createAgentLinksService(db: Database, engagements: EngagementsService) {
  return {
    list: (scope: OrgScope, engagementId: string) =>
      Effect.gen(function* () {
        yield* engagements.forParty(scope, engagementId);
        const data = yield* Effect.promise(() =>
          db
            .select()
            .from(agentLinks)
            .where(eq(agentLinks.engagementId, engagementId))
            .orderBy(asc(agentLinks.ordering), asc(agentLinks.createdAt)),
        );
        return { data };
      }),

    create: (scope: OrgScope, input: { engagementId: string; label: string; url: string }) =>
      Effect.gen(function* () {
        const engagement = yield* engagements.asAgency(scope, input.engagementId);
        if (engagement.status !== "active") {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: "Agent links can be added on an active Engagement.",
            }),
          );
        }
        const existing = yield* Effect.promise(() =>
          db
            .select({ ordering: agentLinks.ordering })
            .from(agentLinks)
            .where(eq(agentLinks.engagementId, engagement.id)),
        );
        const ordering = existing.reduce((max, row) => Math.max(max, row.ordering), -1) + 1;
        const url = yield* Effect.try({
          try: () => linkUrl(input.url),
          catch: (error) =>
            error instanceof ORPCError
              ? error
              : new ORPCError("BAD_REQUEST", { message: "Agent link must be an http(s) URL." }),
        });
        const [link] = yield* Effect.promise(() =>
          db
            .insert(agentLinks)
            .values({
              id: crypto.randomUUID(),
              engagementId: engagement.id,
              label: input.label.trim(),
              url,
              ordering,
            })
            .returning(),
        );
        if (!link) {
          return yield* Effect.fail(
            new ORPCError("INTERNAL_SERVER_ERROR", { message: "Agent link was not saved." }),
          );
        }
        return { link };
      }),

    remove: (scope: OrgScope, id: string) =>
      Effect.gen(function* () {
        const [existing] = yield* Effect.promise(() =>
          db.select().from(agentLinks).where(eq(agentLinks.id, id)).limit(1),
        );
        if (!existing) {
          return yield* Effect.fail(
            new ORPCError("NOT_FOUND", { message: "Agent link not found" }),
          );
        }
        const engagement = yield* engagements.asAgency(scope, existing.engagementId);
        if (engagement.status !== "active") {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: "Agent links can be removed on an active Engagement.",
            }),
          );
        }
        yield* Effect.promise(() => db.delete(agentLinks).where(eq(agentLinks.id, id)));
        return { deleted: true as const };
      }),
  };
}

export type AgentLinksService = ReturnType<typeof createAgentLinksService>;
