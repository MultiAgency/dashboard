import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Effect } from "every-plugin/effect";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { billings } from "../../src/db/schema";
import { runEffect } from "../../src/lib/context";
import { createOrganizationAccess } from "../../src/lib/organization-access";
import type { PluginsClient } from "../../src/lib/plugins-types.gen";
import { createAgencyService } from "../../src/services/agency";
import { createBillingsService } from "../../src/services/billings";
import { createClientPortalService } from "../../src/services/client-portal";
import { createEngagementsService } from "../../src/services/engagements";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { createProjectDirectory } from "../../src/services/project-directory";
import { inMemoryOrganizations } from "../fakes/organizations";
import { inMemoryProjects, orgScope, project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const ALPHA_DAO = "alpha.sputnik-dao.near";

describe("engagements", () => {
  let pg: PGlite;
  let db: Database;

  const alpha = orgScope("org-alpha", { agencyDao: ALPHA_DAO });
  const beta = orgScope("org-beta");
  const acme = orgScope("org-acme");
  const acmeMember = orgScope("org-acme", { role: "member", canSeePrivate: false });
  const stranger = orgScope("org-stranger");

  const projects = [
    project("site", "org-alpha"),
    project("app", "org-alpha"),
    project("internal", "org-alpha"),
    project("beta-work", "org-beta"),
  ];

  let orgs: ReturnType<typeof inMemoryOrganizations>;

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
  });

  beforeEach(async () => {
    await pg.query(
      "TRUNCATE engagements, engagement_projects, billings, organization_daos CASCADE",
    );
    orgs = inMemoryOrganizations([
      { id: "org-alpha", name: "Alpha Agency", daoAccountId: ALPHA_DAO },
      { id: "org-beta", name: "Beta Agency" },
      { id: "org-acme", name: "Acme Corp" },
    ]);
  });

  afterAll(async () => {
    await pg.close();
  });

  const run = <A, E>(effect: Effect.Effect<A, E>) => runEffect(effect);

  function services() {
    const { client } = inMemoryProjects(projects);
    const directory = createProjectDirectory(() => client);
    const listings = createListingsService(db, directory);
    const ledgers = createProjectLedgers(db, listings);
    const plugins = {
      projects: () => client,
      builders: () => ({ listBuilders: async () => ({ data: [] }) }),
    } as unknown as PluginsClient;
    const access = createOrganizationAccess(db, orgs.organizations);
    const engagements = createEngagementsService(db, directory, orgs.organizations);
    const portal = createClientPortalService(
      engagements,
      createAgencyService(db, plugins, directory, listings, ledgers),
      createBillingsService(db, directory),
      {} as never,
      directory,
      ledgers,
      access,
    );
    return { engagements, portal };
  }

  async function activeEngagement() {
    const { engagements } = services();
    const proposed = await run(engagements.propose(alpha, { clientOrganizationId: "org-acme" }));
    return run(engagements.accept(acme, proposed.id));
  }

  describe("lifecycle", () => {
    test("an Agency onboards a new Client and invites its first admin in one step", async () => {
      const { engagements } = services();

      const created = await run(
        engagements.createClient(alpha, { name: "Globex", adminEmail: "ceo@globex.test" }),
      );

      expect(created).toMatchObject({
        status: "active",
        role: "agency",
        agency: { organizationId: "org-alpha" },
        client: { name: "Globex" },
      });
      expect(orgs.invitations).toEqual([
        { organizationId: created.client.organizationId, email: "ceo@globex.test", role: "owner" },
      ]);
    });

    test("an existing Organization accepts a proposed Engagement", async () => {
      const { engagements } = services();

      const proposed = await run(engagements.propose(alpha, { clientOrganizationId: "org-acme" }));
      const clientView = await run(engagements.list(acme));
      const accepted = await run(engagements.accept(acme, proposed.id));

      expect(proposed.status).toBe("proposed");
      expect(clientView.data).toEqual([
        expect.objectContaining({ id: proposed.id, role: "client", status: "proposed" }),
      ]);
      expect(accepted).toMatchObject({
        status: "active",
        role: "client",
        agency: { name: "Alpha Agency" },
        client: { name: "Acme Corp" },
      });
    });

    test("only the proposed Client can accept or decline", async () => {
      const { engagements } = services();
      const proposed = await run(engagements.propose(alpha, { clientOrganizationId: "org-acme" }));

      await expect(run(engagements.accept(alpha, proposed.id))).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(run(engagements.accept(stranger, proposed.id))).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      const declined = await run(engagements.decline(acme, proposed.id));
      expect(declined.status).toBe("declined");
    });

    test("there is at most one active Engagement per Agency and Client", async () => {
      const { engagements } = services();
      await activeEngagement();

      await expect(
        run(engagements.propose(alpha, { clientOrganizationId: "org-acme" })),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        run(engagements.propose(alpha, { clientOrganizationId: "org-alpha" })),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    test("an Agency can be another Agency's Client", async () => {
      const { engagements } = services();
      const proposed = await run(engagements.propose(alpha, { clientOrganizationId: "org-beta" }));
      await run(engagements.accept(beta, proposed.id));

      const listed = await run(engagements.list(beta));

      expect(listed.data).toEqual([
        expect.objectContaining({
          role: "client",
          agency: expect.objectContaining({ organizationId: "org-alpha" }),
        }),
      ]);
    });
  });

  describe("sharing Projects", () => {
    test("a Project can be shared with several Clients, each seeing it in full", async () => {
      const { engagements, portal } = services();
      const withAcme = await activeEngagement();
      const withBeta = await run(
        engagements.accept(
          beta,
          (await run(engagements.propose(alpha, { clientOrganizationId: "org-beta" }))).id,
        ),
      );

      await run(engagements.share(alpha, { engagementId: withAcme.id, projectId: "site" }));
      await run(engagements.share(alpha, { engagementId: withBeta.id, projectId: "site" }));
      await run(engagements.share(alpha, { engagementId: withAcme.id, projectId: "app" }));

      const acmeProjects = await run(
        portal.listProjects(acmeMember, { engagementId: withAcme.id }),
      );
      const betaProjects = await run(portal.listProjects(beta, { engagementId: withBeta.id }));
      const opened = await run(
        portal.getProject(acmeMember, { engagementId: withAcme.id, slug: "slug-site" }),
      );

      expect(acmeProjects.data.map((p) => p.id).sort()).toEqual(["app", "site"]);
      expect(betaProjects.data.map((p) => p.id)).toEqual(["site"]);
      expect(opened.project.id).toBe("site");
      await expect(
        run(portal.getProject(acmeMember, { engagementId: withAcme.id, slug: "slug-internal" })),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("an Agency shares only its own Projects and can unshare them", async () => {
      const { engagements, portal } = services();
      const engagement = await activeEngagement();

      await expect(
        run(engagements.share(alpha, { engagementId: engagement.id, projectId: "beta-work" })),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        run(engagements.share(beta, { engagementId: engagement.id, projectId: "beta-work" })),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      await run(engagements.share(alpha, { engagementId: engagement.id, projectId: "site" }));
      await run(engagements.unshare(alpha, { engagementId: engagement.id, projectId: "site" }));

      expect((await run(portal.listProjects(acme, { engagementId: engagement.id }))).data).toEqual(
        [],
      );
    });

    test("a Client sees every Billing on its shared Projects", async () => {
      const { engagements, portal } = services();
      const engagement = await activeEngagement();
      await run(engagements.share(alpha, { engagementId: engagement.id, projectId: "site" }));
      await db.insert(billings).values([
        { id: "b1", projectId: "site", tokenId: "near", amount: "5", proposalId: "p-1" },
        { id: "b2", projectId: "internal", tokenId: "near", amount: "7", proposalId: "p-2" },
      ]);

      const listed = await run(
        portal.listBillings(acmeMember, { engagementId: engagement.id, limit: 50 }),
      );

      expect(listed.data.map((b) => b.id)).toEqual(["b1"]);
    });
  });

  describe("ending and isolation", () => {
    test("an ended Engagement stays readable for the Client but takes no new work", async () => {
      const { engagements, portal } = services();
      const engagement = await activeEngagement();
      await run(engagements.share(alpha, { engagementId: engagement.id, projectId: "site" }));

      await expect(run(engagements.end(acme, engagement.id))).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      const ended = await run(engagements.end(alpha, engagement.id));

      expect(ended.status).toBe("ended");
      expect(
        (await run(portal.listProjects(acme, { engagementId: engagement.id }))).data.map(
          (p) => p.id,
        ),
      ).toEqual(["site"]);
      await expect(
        run(engagements.share(alpha, { engagementId: engagement.id, projectId: "app" })),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await activeEngagement();
    });

    test("other Organizations cannot see an Engagement or its Projects", async () => {
      const { engagements, portal } = services();
      const engagement = await activeEngagement();
      await run(engagements.share(alpha, { engagementId: engagement.id, projectId: "site" }));

      expect((await run(engagements.list(stranger))).data).toEqual([]);
      await expect(
        run(portal.listProjects(stranger, { engagementId: engagement.id })),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
