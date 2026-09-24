import { beforeEach, describe, expect, test } from "vitest";
import { createAgencyService } from "../../src/services/agency";
import { type AcceptIdeaInput, createIdeasService } from "../../src/services/ideas";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { clientWorkWorld, refused } from "../fakes/engagements";
import { project } from "../fakes/projects";

describe("Client ideas", () => {
  const state = clientWorkWorld();
  let ideas: ReturnType<typeof createIdeasService>;
  let suffixes: string[];
  let acmeEngagement: string;

  beforeEach(async () => {
    const { db, world } = state;
    const listings = createListingsService(db, world.directory);
    suffixes = [];
    ideas = createIdeasService({
      db,
      agency: createAgencyService(
        db,
        world.plugins,
        world.directory,
        listings,
        createProjectLedgers(db, listings),
      ),
      directory: world.directory,
      readScopeOfAgency: world.access.readScopeOfAgency,
      engagements: world.engagements,
      notifications: world.notifications,
      organizations: world.organizations.directory,
      slugSuffix: () => suffixes.shift() ?? crypto.randomUUID().slice(0, 6),
    });
    acmeEngagement = (await world.activeEngagement("acme")).id;
  });

  const world = () => state.world;
  const studio = () => world().manager("studio-admin", "studio");
  const acmeMember = () => world().member("acme-member", "acme");
  const acmeOwner = () => world().manager("acme-owner", "acme");
  const inbox = async (userId: string) =>
    (await world().notifications.list(userId, { limit: 50 })).data.map((n) => n.kind);
  const clientList = async () =>
    (await ideas.list(await acmeMember(), { engagementId: acmeEngagement })).data;

  async function submit(title = "Better reports", description = "Monthly PDF please") {
    return ideas.submit(await acmeMember(), { engagementId: acmeEngagement, title, description });
  }

  const accept = async (id: string, input: Partial<AcceptIdeaInput> = {}) =>
    ideas.accept(await studio(), {
      id,
      kind: "project",
      title: "Reports v2",
      slug: "reports-v2",
      share: true,
      ...input,
    });

  describe("submitting", () => {
    test("any Client member submits an idea the Agency owns privately, and its admins are told", async () => {
      const idea = await submit();

      expect(idea).toMatchObject({ status: "new", title: "Better reports" });
      const upstream = world().upstreamProjects.find((p) => p.id === idea.id)!;
      expect(upstream).toMatchObject({
        organizationId: "studio",
        kind: "idea",
        visibility: "private",
        ownerId: "acme-member",
        title: "Better reports",
      });
      expect(upstream.slug).toMatch(/^better-reports-[a-z0-9]+$/);
      expect(await inbox("studio-admin")).toContain("idea_submitted");
      expect(await inbox("studio-member")).not.toContain("idea_submitted");
      expect(await inbox("acme-member")).not.toContain("idea_submitted");
    });

    test("slugs are generated, unique, and retried when taken", async () => {
      world().upstreamProjects.push({
        ...project("taken", "rival"),
        slug: "better-reports-aaaaaa",
      });
      suffixes.push("aaaaaa", "bbbbbb");

      const first = await submit();
      const second = await submit();

      expect(first.slug).toBe("better-reports-bbbbbb");
      expect(second.slug).not.toBe(first.slug);
    });

    test.each([
      ["a proposed Engagement", "globex-owner", "globex", "NOT_ACTIVE"],
      ["an ended Engagement", "acme-member", "acme", "NOT_ACTIVE"],
      ["another Organization", "rival-admin", "rival", "NOT_FOUND"],
      ["the Agency itself", "studio-admin", "studio", "NOT_FOUND"],
    ])("is refused through %s", async (_, userId, organizationId, reason) => {
      let engagementId = acmeEngagement;
      if (organizationId === "globex") {
        const proposed = await world().engagements.propose(await studio(), {
          slug: "globex",
          name: "Globex",
        });
        engagementId = proposed.id;
      }
      if (organizationId === "acme") await world().engagements.end(await studio(), acmeEngagement);

      await refused(
        ideas.submit(await world().member(userId, organizationId), {
          engagementId,
          title: "Refused",
        }),
        reason,
      );
    });
  });

  describe("visibility", () => {
    test("only the Client and its Agency see it, never other Clients or Subcontractors", async () => {
      const idea = await submit();
      const globexEngagement = (await world().activeEngagement("globex")).id;
      await world().engagements.subcontract(await studio(), {
        slug: "crew",
        name: "Crew",
        projectIds: ["site"],
      });
      const globex = await world().member("globex-owner", "globex");
      const crew = await world().member("crew-owner", "crew");
      const inboxView = await ideas.list(await studio(), { engagementId: acmeEngagement });

      expect((await clientList()).map((i) => i.id)).toEqual([idea.id]);
      expect(inboxView.data).toEqual([
        expect.objectContaining({ id: idea.id, status: "new", submittedByUserId: "acme-member" }),
      ]);
      expect((await ideas.list(globex, { engagementId: globexEngagement })).data).toEqual([]);
      await refused(ideas.list(globex, { engagementId: acmeEngagement }), "NOT_FOUND");
      await refused(ideas.list(crew, { engagementId: acmeEngagement }), "NOT_FOUND");
      expect(
        (await world().engagements.sharedWithUs(crew)).data.map((s) => s.project.id),
      ).not.toContain(idea.id);
      await refused(world().access.workableProject(crew, idea.id), "NOT_FOUND");
      await refused(world().access.workableProject(globex, idea.id), "NOT_FOUND");
    });
  });

  describe("the Agency inbox", () => {
    test("accepting converts the idea into a shared Project the Client can open", async () => {
      const idea = await submit();

      const accepted = await accept(idea.id);

      expect(accepted).toMatchObject({
        status: "accepted",
        result: { slug: "reports-v2", title: "Reports v2", kind: "project", shared: true },
      });
      const created = world().upstreamProjects.find((p) => p.slug === "reports-v2")!;
      expect(created.organizationId).toBe("studio");
      expect((await clientList())[0]).toMatchObject({
        status: "accepted",
        result: { id: created.id, slug: "reports-v2", shared: true },
      });
      const engagement = await world().engagements.get(await acmeOwner(), acmeEngagement);
      expect(engagement.projectIds).toContain(created.id);
    });

    test("an idea accepted as an unshared scope shows its status but no link to the Client", async () => {
      const idea = await submit();

      await accept(idea.id, {
        kind: "scope",
        title: "Reports scope",
        slug: "reports-scope",
        parentSlug: "site",
        share: false,
      });

      expect((await clientList())[0]).toMatchObject({ status: "accepted", result: null });
      const agencyView = await ideas.list(await studio(), { engagementId: acmeEngagement });
      expect(agencyView.data[0]?.result).toMatchObject({
        kind: "scope",
        slug: "reports-scope",
        shared: false,
      });
    });

    test("the submitter and the Client's owners and admins hear about the decision", async () => {
      const first = await submit("First");
      const second = await submit("Second");

      await accept(first.id);
      const declined = await ideas.decline(await studio(), { id: second.id });

      expect(declined.status).toBe("declined");
      for (const userId of ["acme-member", "acme-owner"]) {
        expect(await inbox(userId)).toEqual(
          expect.arrayContaining(["idea_accepted", "idea_declined"]),
        );
      }
      expect(await inbox("studio-admin")).not.toContain("idea_accepted");
    });

    test("only the Agency decides, once, and not after the Engagement ended", async () => {
      const decided = await submit("Decided");
      const idea = await submit();
      await ideas.decline(await studio(), { id: decided.id });

      await refused(accept(decided.id, { slug: "late" }), "IDEA_DECIDED");
      expect(world().upstreamProjects.some((p) => p.slug === "late")).toBe(false);
      await refused(ideas.decline(await acmeOwner(), { id: idea.id }), "NOT_FOUND");
      await world().engagements.end(await studio(), acmeEngagement);
      await refused(ideas.decline(await studio(), { id: idea.id }), "NOT_ACTIVE");
      expect((await clientList()).find((i) => i.id === idea.id)?.status).toBe("new");
    });
  });
});
