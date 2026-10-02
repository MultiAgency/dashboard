import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Effect, Either } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { projectContributors } from "../../src/db/schema";
import { runEffect } from "../../src/lib/context";
import type { PluginsClient } from "../../src/lib/plugins-types.gen";
import { createContributorsService } from "../../src/services/contributors";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { createNearnService } from "../../src/services/nearn";
import { createProjectDirectory } from "../../src/services/project-directory";
import { createProposalsService } from "../../src/services/proposals";
import { createTreasuryService } from "../../src/services/treasury";
import { agencyScope, inMemoryProjects } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

let daoCounter = 0;
const uniqueDao = () => `upstream-test-${++daoCounter}.sputnik-dao.near`;

describe("when upstream services fail", () => {
  let pg: PGlite;
  let db: Database;
  const originalFetch = globalThis.fetch;
  const directory = createProjectDirectory(() => inMemoryProjects([]).client);

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
  });

  beforeEach(async () => {
    await pg.query("TRUNCATE project_contributors");
    globalThis.fetch = (async () => {
      throw new Error("upstream unreachable");
    }) as typeof fetch;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await pg.close();
  });

  describe("proposals", () => {
    test("the public summary shows no proposals instead of failing", async () => {
      const proposals = createProposalsService(db, directory);
      const scope = agencyScope(uniqueDao(), { role: null, canSeePrivate: false });

      const summary = await Effect.runPromise(proposals.getPublicSummary(scope));

      expect(summary).toEqual({ openCount: 0, totalCount: 0 });
    });

    test("visitors get an empty list, members still see the failure", async () => {
      const proposals = createProposalsService(db, directory);
      const visitor = agencyScope(uniqueDao(), { role: null, canSeePrivate: false });
      const admin = agencyScope(uniqueDao());

      expect(await Effect.runPromise(proposals.list(visitor, { limit: 10 }))).toEqual({
        data: [],
        lastProposalId: 0,
        nextFromIndex: null,
      });
      await expect(Effect.runPromise(proposals.list(admin, { limit: 10 }))).rejects.toThrow(
        "upstream unreachable",
      );
    });
  });

  describe("treasury", () => {
    test("public balances and summary show zero instead of failing", async () => {
      const treasury = createTreasuryService(
        directory,
        createProjectLedgers(db, createListingsService(db, directory)),
      );
      const scope = agencyScope(uniqueDao(), { role: null, canSeePrivate: false });

      expect(
        await Effect.runPromise(treasury.getPublicBalances(scope, { tokenIds: ["near"] })),
      ).toEqual({ balances: [{ tokenId: "near", balance: "0" }] });
      expect(await Effect.runPromise(treasury.getPublicSummary(scope))).toEqual({
        nearBalance: "0",
        ftTokens: 0,
      });
    });
  });

  describe("NEARN", () => {
    test("a listing NEARN does not know is NOT_FOUND", async () => {
      globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
      const nearn = createNearnService();

      const outcome = await Effect.runPromise(
        Effect.either(nearn.getListing(agencyScope(uniqueDao()), { slug: "gone-listing" })),
      );

      expect(Either.isLeft(outcome) && outcome.left).toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("contributors", () => {
    function contributorsWith(builders: Record<string, unknown>, contexts: unknown[] = []) {
      const plugins = {
        builders: (context: unknown) => {
          contexts.push(context);
          return builders;
        },
      } as unknown as PluginsClient;
      return createContributorsService(db, plugins);
    }

    test("an assigned contributor without a builder profile gets an unregistered stub", async () => {
      await db
        .insert(projectContributors)
        .values({ projectId: "p1", nearAccount: "dev.near", role: "lead" });
      const contributors = contributorsWith({
        getBuilder: async () => {
          throw new Error("Builder not found");
        },
      });

      const { contributor } = await Effect.runPromise(contributors.get({}, "dev.near"));

      expect(contributor).toMatchObject({ nearAccount: "dev.near", registered: false });
    });

    test("updating someone with no builder profile creates one, unclaimed", async () => {
      const created: string[] = [];
      const contexts: unknown[] = [];
      const contributors = contributorsWith(
        {
          updateBuilderProfile: async () => {
            throw new ORPCError("NOT_FOUND", { message: "Builder not found" });
          },
          createBuilder: async (input: { nearAccount: string; name?: string }) => {
            created.push(input.nearAccount);
            return {
              data: {
                nearAccount: input.nearAccount,
                name: input.name ?? null,
                bio: null,
                skills: [],
                location: null,
                links: null,
                userId: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            };
          },
        },
        contexts,
      );

      const { contributor } = await Effect.runPromise(
        contributors.update({}, { nearAccount: "new.near", name: "New" }),
      );

      expect(created).toEqual(["new.near"]);
      expect(contributor).toMatchObject({
        nearAccount: "new.near",
        name: "New",
        registered: true,
        claimed: false,
      });
      // The builders plugin creates a profile for someone else's account only for a trusted caller.
      expect(contexts.at(-1)).toMatchObject({ trusted: true });
    });

    const profileOf = (userId: string | null) => ({
      data: {
        nearAccount: "ada.near",
        name: "Ada",
        bio: null,
        skills: [],
        location: null,
        links: null,
        userId,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    test.each([
      ["an unclaimed profile to a manager", null, true, true],
      ["an unclaimed profile to a member", null, false, false],
      ["a claimed profile to a manager", "ada-user", true, false],
    ] as const)("offers edit and remove for %s", async (_, userId, canManage, allowed) => {
      const contributors = contributorsWith({ getBuilder: async () => profileOf(userId) });

      const result = await Effect.runPromise(
        contributors.get({ userId: "manager" }, "ada.near", { canManage }),
      );

      expect(result).toMatchObject({ canEdit: allowed, canDelete: allowed });
    });

    test("removing a builder still assigned to a Project is refused", async () => {
      await db
        .insert(projectContributors)
        .values({ projectId: "p1", nearAccount: "ada.near", role: "lead" });
      const deleted: string[] = [];
      const contributors = contributorsWith({
        deleteBuilder: async ({ nearAccount }: { nearAccount: string }) => {
          deleted.push(nearAccount);
          return { deleted: true };
        },
      });

      const outcome = await Effect.runPromise(
        Effect.either(contributors.delete({}, "ada.near")),
      );

      expect(Either.isLeft(outcome) && outcome.left).toMatchObject({ code: "BAD_REQUEST" });
      expect(deleted).toEqual([]);
    });

    test("removing an unassigned builder deletes the profile as a trusted caller", async () => {
      const contexts: unknown[] = [];
      const contributors = contributorsWith(
        { deleteBuilder: async () => ({ deleted: true }) },
        contexts,
      );

      expect(await Effect.runPromise(contributors.delete({}, "ada.near"))).toEqual({
        deleted: true,
      });
      expect(contexts.at(-1)).toMatchObject({ trusted: true });
    });

    test("a refused edit of someone else's builder profile is not turned into a create", async () => {
      const created: string[] = [];
      const contributors = contributorsWith({
        updateBuilderProfile: async () => {
          throw new ORPCError("FORBIDDEN", { message: "Only the builder can edit this profile" });
        },
        createBuilder: async (input: { nearAccount: string }) => {
          created.push(input.nearAccount);
          throw new Error("must not be called");
        },
      });

      await expect(
        runEffect(contributors.update({}, { nearAccount: "taken.near", name: "Hijack" })),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(created).toEqual([]);
    });
  });
});
