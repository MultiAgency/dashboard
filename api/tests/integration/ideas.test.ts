import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { createAgencyService } from "../../src/services/agency";
import { createIdeasService } from "../../src/services/ideas";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { engagementWorld } from "../fakes/engagements";
import { project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const organizations = [
  { id: "studio", name: "Studio", slug: "studio" },
  { id: "acme", name: "Acme Corp", slug: "acme" },
  { id: "globex", name: "Globex", slug: "globex" },
  { id: "crew", name: "Crew", slug: "crew" },
  { id: "rival", name: "Rival", slug: "rival" },
];

const members = [
  { userId: "studio-admin", organizationId: "studio", role: "admin" as const },
  { userId: "studio-member", organizationId: "studio", role: "member" as const },
  { userId: "acme-owner", organizationId: "acme", role: "owner" as const },
  { userId: "acme-member", organizationId: "acme", role: "member" as const },
  { userId: "globex-owner", organizationId: "globex", role: "owner" as const },
  { userId: "crew-owner", organizationId: "crew", role: "owner" as const },
  { userId: "rival-admin", organizationId: "rival", role: "owner" as const },
];

const users = members.map((m) => ({ id: m.userId, email: `${m.userId}@example.com` }));

const projects = [{ ...project("site", "studio"), slug: "site", title: "Website" }];

describe("Client ideas", () => {
  let pg: PGlite;
  let db: Database;
  let world: Awaited<ReturnType<typeof engagementWorld>>;
  let ideas: ReturnType<typeof createIdeasService>;
  let suffixes: string[];
  let acmeEngagement: string;

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
    world = await engagementWorld(db, { organizations, members, users, projects });
    const listings = createListingsService(db, world.directory);
    const agency = createAgencyService(
      db,
      world.plugins,
      world.directory,
      listings,
      createProjectLedgers(db, listings),
    );
    suffixes = [];
    ideas = createIdeasService({
      db,
      agency,
      directory: world.directory,
      readScopeOfAgency: world.access.readScopeOfAgency,
      engagements: world.engagements,
      notifications: world.notifications,
      organizations: world.organizations.directory,
      slugSuffix: () => suffixes.shift() ?? crypto.randomUUID().slice(0, 6),
    });
    acmeEngagement = await engage("acme", "acme-owner", "Acme Corp");
  });

  afterEach(async () => {
    await pg.close();
  });

  const studio = () => world.manager("studio-admin", "studio");
  const acmeMember = () => world.member("acme-member", "acme");
  const acmeOwner = () => world.manager("acme-owner", "acme");
  const inbox = async (userId: string) =>
    (await world.notifications.list(userId, { limit: 50 })).data.map((n) => n.kind);

  async function engage(slug: string, ownerId: string, name: string) {
    const proposed = await world.engagements.propose(await studio(), { slug, name });
    await world.engagements.accept(await world.manager(ownerId, slug), proposed.id);
    return proposed.id;
  }

  async function submit(title = "Better reports", description = "Monthly PDF please") {
    return ideas.submit(await acmeMember(), {
      engagementId: acmeEngagement,
      title,
      description,
    });
  }

  describe("submitting", () => {
    test("any Client member submits an idea that the Agency owns, privately, created by them", async () => {
      const idea = await submit();

      expect(idea).toMatchObject({ status: "new", title: "Better reports" });
      const upstream = world.upstreamProjects.find((p) => p.id === idea.id)!;
      expect(upstream).toMatchObject({
        organizationId: "studio",
        kind: "idea",
        visibility: "private",
        ownerId: "acme-member",
        title: "Better reports",
      });
      expect(upstream.slug).toMatch(/^better-reports-[a-z0-9]+$/);
    });

    test("slugs are generated, unique, and retried when taken", async () => {
      world.upstreamProjects.push({
        ...project("taken", "rival"),
        slug: "better-reports-aaaaaa",
      });
      suffixes.push("aaaaaa", "bbbbbb");

      const first = await submit();
      const second = await submit();

      expect(first.slug).toBe("better-reports-bbbbbb");
      expect(second.slug).not.toBe(first.slug);
    });

    test("the Agency's owners and admins are told", async () => {
      await submit();

      expect(await inbox("studio-admin")).toContain("idea_submitted");
      expect(await inbox("studio-member")).not.toContain("idea_submitted");
      expect(await inbox("acme-member")).not.toContain("idea_submitted");
    });

    test("is refused on a proposed or ended Engagement", async () => {
      const proposed = await world.engagements.propose(await studio(), {
        slug: "globex",
        name: "Globex",
      });
      await expect(
        ideas.submit(await world.member("globex-owner", "globex"), {
          engagementId: proposed.id,
          title: "Too early",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", data: { reason: "NOT_ACTIVE" } });

      await world.engagements.end(await studio(), acmeEngagement);
      await expect(submit()).rejects.toMatchObject({
        code: "BAD_REQUEST",
        data: { reason: "NOT_ACTIVE" },
      });
    });

    test("is refused for anyone who is not a member of the Client", async () => {
      await expect(
        ideas.submit(await world.member("rival-admin", "rival"), {
          engagementId: acmeEngagement,
          title: "Sneaky",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        ideas.submit(await studio(), { engagementId: acmeEngagement, title: "Own idea" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(world.member("rival-admin", "acme")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("visibility", () => {
    test("the Client sees its own Engagement's ideas; the Agency sees them in its inbox", async () => {
      const idea = await submit();

      const client = await ideas.list(await acmeOwner(), { engagementId: acmeEngagement });
      const inboxView = await ideas.list(await studio(), { engagementId: acmeEngagement });

      expect(client.data.map((i) => i.id)).toEqual([idea.id]);
      expect(inboxView.data).toEqual([
        expect.objectContaining({ id: idea.id, status: "new", submittedByUserId: "acme-member" }),
      ]);
    });

    test("other Clients and Subcontractors of the Agency never see it", async () => {
      const idea = await submit();
      const globexEngagement = await engage("globex", "globex-owner", "Globex");
      await world.engagements.subcontract(await studio(), {
        slug: "crew",
        name: "Crew",
        projectIds: ["site"],
      });
      const globex = await world.member("globex-owner", "globex");
      const crew = await world.member("crew-owner", "crew");

      expect((await ideas.list(globex, { engagementId: globexEngagement })).data).toEqual([]);
      await expect(ideas.list(globex, { engagementId: acmeEngagement })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(ideas.list(crew, { engagementId: acmeEngagement })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(
        (await world.engagements.sharedWithUs(crew)).data.map((s) => s.project.id),
      ).not.toContain(idea.id);
      await expect(world.access.workableProject(crew, idea.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(world.access.workableProject(globex, idea.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("the Agency inbox", () => {
    test("accepting converts the idea into a shared Project the Client can open", async () => {
      const idea = await submit();

      const accepted = await ideas.accept(await studio(), {
        id: idea.id,
        kind: "project",
        title: "Reports v2",
        slug: "reports-v2",
        share: true,
      });

      expect(accepted).toMatchObject({
        status: "accepted",
        result: { slug: "reports-v2", title: "Reports v2", kind: "project", shared: true },
      });
      const created = world.upstreamProjects.find((p) => p.slug === "reports-v2")!;
      expect(created.organizationId).toBe("studio");
      const [clientView] = (await ideas.list(await acmeMember(), { engagementId: acmeEngagement }))
        .data;
      expect(clientView).toMatchObject({
        status: "accepted",
        result: { id: created.id, slug: "reports-v2", shared: true },
      });
      expect((await world.engagements.get(await acmeOwner(), acmeEngagement)).projectIds).toContain(
        created.id,
      );
    });

    test("an accepted idea that is not shared shows its status but no link to the Client", async () => {
      const idea = await submit();

      await ideas.accept(await studio(), {
        id: idea.id,
        kind: "project",
        title: "Internal follow-up",
        slug: "internal-follow-up",
        share: false,
      });

      const [clientView] = (await ideas.list(await acmeMember(), { engagementId: acmeEngagement }))
        .data;
      expect(clientView).toMatchObject({ status: "accepted", result: null });
      const [agencyView] = (await ideas.list(await studio(), { engagementId: acmeEngagement }))
        .data;
      expect(agencyView?.result).toMatchObject({ slug: "internal-follow-up", shared: false });
    });

    test("accepting as a scope mentions the parent Project", async () => {
      const idea = await submit();

      const accepted = await ideas.accept(await studio(), {
        id: idea.id,
        kind: "scope",
        title: "Reports scope",
        slug: "reports-scope",
        parentSlug: "site",
        share: false,
      });

      expect(accepted.result).toMatchObject({ kind: "scope", slug: "reports-scope" });
    });

    test("the submitter and the Client's owners and admins hear about the decision", async () => {
      const first = await submit("First");
      const second = await submit("Second");

      await ideas.accept(await studio(), {
        id: first.id,
        kind: "project",
        title: "First",
        slug: "first",
        share: true,
      });
      const declined = await ideas.decline(await studio(), { id: second.id });

      expect(declined.status).toBe("declined");
      expect(await inbox("acme-member")).toEqual(
        expect.arrayContaining(["idea_accepted", "idea_declined"]),
      );
      expect(await inbox("acme-owner")).toEqual(
        expect.arrayContaining(["idea_accepted", "idea_declined"]),
      );
      expect(await inbox("studio-admin")).not.toContain("idea_accepted");
    });

    test("a decided idea cannot be decided again", async () => {
      const idea = await submit();
      await ideas.decline(await studio(), { id: idea.id });

      await expect(
        ideas.accept(await studio(), {
          id: idea.id,
          kind: "project",
          title: "Late",
          slug: "late",
          share: false,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", data: { reason: "IDEA_DECIDED" } });
      expect(world.upstreamProjects.some((p) => p.slug === "late")).toBe(false);
    });

    test("only the Agency decides, and not after the Engagement ended", async () => {
      const idea = await submit();

      await expect(ideas.decline(await acmeOwner(), { id: idea.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      await world.engagements.end(await studio(), acmeEngagement);
      await expect(ideas.decline(await studio(), { id: idea.id })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        data: { reason: "NOT_ACTIVE" },
      });
      expect((await ideas.list(await acmeMember(), { engagementId: acmeEngagement })).data).toEqual(
        [expect.objectContaining({ id: idea.id, status: "new" })],
      );
    });
  });
});
