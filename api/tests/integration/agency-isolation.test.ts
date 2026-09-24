import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { billings, budgets, clients, projectContributors } from "../../src/db/schema";
import { createAssignmentsService } from "../../src/services/assignments";
import { createBillingsService } from "../../src/services/billings";
import { createBudgetsService } from "../../src/services/budgets";
import { createClientPortalService } from "../../src/services/client-portal";
import { createClientsService } from "../../src/services/clients";
import {
  type AgencyScope,
  createOrganizationAccess,
  type OrganizationAccessService,
  ROLE_MATRIX,
} from "../../src/services/organization-access";
import { createProjectDirectory } from "../../src/services/project-directory";
import { inMemoryOrganizations, signedIn } from "../fakes/organizations";
import { inMemoryProjects, project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const ALPHA = "alpha.sputnik-dao.near";
const BETA = "beta.sputnik-dao.near";

describe("agency isolation", () => {
  let pg: PGlite;
  let db: Database;
  let access: OrganizationAccessService;
  let alpha: AgencyScope;
  let beta: AgencyScope;
  let alphaTreasurer: AgencyScope;
  const directory = createProjectDirectory(
    () =>
      inMemoryProjects([
        project("alpha-project", ALPHA),
        project("alpha-other", ALPHA),
        project("beta-project", BETA),
      ]).client,
  );

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
    access = createOrganizationAccess({
      db,
      organizations: inMemoryOrganizations({
        organizations: [
          { id: "alpha-org", daoAccountId: ALPHA },
          { id: "beta-org", daoAccountId: BETA },
        ],
        members: [
          { userId: "alpha-admin", organizationId: "alpha-org", role: "admin" },
          { userId: "alpha-treasurer", organizationId: "alpha-org", role: "owner" },
          { userId: "beta-admin", organizationId: "beta-org", role: "admin" },
        ],
      }).port,
    });
    alpha = await access.agencyScope(
      signedIn("alpha-admin", "alpha-org", "admin.near"),
      ROLE_MATRIX.manage,
    );
    beta = await access.agencyScope(
      signedIn("beta-admin", "beta-org", "admin.near"),
      ROLE_MATRIX.manage,
    );
    alphaTreasurer = await access.agencyScope(
      signedIn("alpha-treasurer", "alpha-org", "treasurer.near"),
      ROLE_MATRIX.manage,
    );
  });

  beforeEach(async () => {
    await pg.query(
      "TRUNCATE clients, client_projects, project_contributors, budgets, billings CASCADE",
    );
  });

  afterAll(async () => {
    await pg.close();
  });

  const run = <A>(effect: import("every-plugin/effect").Effect.Effect<A, unknown>) =>
    import("every-plugin/effect").then(({ Effect }) => Effect.runPromise(effect as never) as A);

  async function betaClient() {
    const created = await run(
      createClientsService(db, directory).create(beta, {
        orgId: "beta-org",
        name: "Beta Corp",
        projectIds: ["beta-project"],
      }),
    );
    return created.client.id;
  }

  describe("clients", () => {
    test("a client cannot be stored without an agency", async () => {
      await expect(
        pg.query(`insert into clients (id, org_id, name) values ('orphan', 'org', 'Orphan')`),
      ).rejects.toThrow(/agency_dao_account_id/);
    });

    test("an agency lists only its own clients", async () => {
      const service = createClientsService(db, directory);
      await betaClient();
      await run(service.create(alpha, { orgId: "alpha-org", name: "Alpha Corp" }));

      const listed = await run(service.list(alpha));

      expect(listed.data.map((c) => c.name)).toEqual(["Alpha Corp"]);
    });

    test("another agency's client cannot be read, edited, deleted or used as a filter", async () => {
      const service = createClientsService(db, directory);
      const id = await betaClient();

      await expect(run(service.get(alpha, id))).rejects.toThrow("Client not found");
      await expect(run(service.update(alpha, { id, name: "Stolen" }))).rejects.toThrow(
        "Client not found",
      );
      await expect(run(service.delete(alpha, id))).rejects.toThrow("Client not found");
      await expect(run(service.projectIdsFor(alpha, id))).rejects.toThrow("Client not found");

      const [row] = await db.select().from(clients);
      expect(row).toMatchObject({ name: "Beta Corp", agencyDaoAccountId: BETA });
    });

    test("people can only look up client memberships for their own NEAR accounts", async () => {
      await run(
        createClientsService(db, directory).create(beta, {
          orgId: "beta-org",
          name: "Beta Corp",
          nearAccountId: "ceo.near",
        }),
      );
      const ceo = { near: { primaryAccountId: "ceo.near", linkedAccounts: [] } };
      const stranger = {
        near: { primaryAccountId: "stranger.near", linkedAccounts: [{ accountId: "alt.near" }] },
      };

      const own = await run(access.clientMemberships(ceo, "ceo.near"));
      expect(own.map((m) => m.client.name)).toEqual(["Beta Corp"]);
      await expect(run(access.clientMemberships(stranger, "ceo.near"))).rejects.toThrow(
        "You can only look up your own NEAR accounts",
      );
      expect(await run(access.clientMemberships(stranger, "alt.near"))).toEqual([]);
    });

    test("a client can only be linked to the agency's own projects", async () => {
      const service = createClientsService(db, directory);

      await expect(
        run(
          service.create(alpha, {
            orgId: "alpha-org",
            name: "Greedy",
            projectIds: ["beta-project"],
          }),
        ),
      ).rejects.toThrow("Project not found");
      expect(await db.select().from(clients)).toHaveLength(0);
    });
  });

  describe("assignments", () => {
    test("an agency cannot remove contributors from another agency's project", async () => {
      await db
        .insert(projectContributors)
        .values({ projectId: "beta-project", nearAccount: "dev.near", role: "lead" });

      await expect(
        run(
          createAssignmentsService(db, directory).delete(alpha, {
            projectId: "beta-project",
            nearAccount: "dev.near",
          }),
        ),
      ).rejects.toThrow("Project not found");
      expect(await db.select().from(projectContributors)).toHaveLength(1);
    });
  });

  describe("budgets", () => {
    async function allocate(projectId: string, amount: string) {
      await db.insert(budgets).values({
        id: crypto.randomUUID(),
        projectId,
        tokenId: "near",
        amount,
        actorAccountId: "admin.near",
      });
    }

    test("an agency's budget history excludes other agencies' projects", async () => {
      await allocate("alpha-project", "10");
      await allocate("beta-project", "99");
      const service = createBudgetsService(db, directory, createClientsService(db, directory));

      const listed = await run(service.list(alpha, { limit: 50 }));

      expect(listed.data.map((b) => b.projectId)).toEqual(["alpha-project"]);
    });

    test("another agency's client cannot be used to filter budgets", async () => {
      const clientId = await betaClient();
      const service = createBudgetsService(db, directory, createClientsService(db, directory));

      await expect(run(service.list(alpha, { clientId, limit: 50 }))).rejects.toThrow(
        "Client not found",
      );
    });

    test("allocations are recorded against the acting member", async () => {
      const service = createBudgetsService(db, directory, createClientsService(db, directory));

      const { budget } = await run(
        service.create(alphaTreasurer, {
          projectId: "alpha-project",
          tokenId: "near",
          amount: "5",
        }),
      );

      expect(budget).toMatchObject({
        actorAccountId: "treasurer.near",
        note: null,
        clientId: null,
      });
      const betaClientId = await betaClient();
      await expect(
        run(
          service.create(alpha, {
            projectId: "alpha-project",
            tokenId: "near",
            amount: "5",
            clientId: betaClientId,
          }),
        ),
      ).rejects.toThrow("Client not found");
      await expect(
        run(service.create(alpha, { projectId: "beta-project", tokenId: "near", amount: "5" })),
      ).rejects.toThrow("Project not found");
    });
  });

  describe("client portal billings", () => {
    test("a client listing billings without a project only sees linked projects", async () => {
      const clientsService = createClientsService(db, directory);
      const created = await run(
        clientsService.create(alpha, {
          orgId: "alpha-org",
          name: "Alpha Corp",
          nearAccountId: "client.near",
          projectIds: ["alpha-project"],
        }),
      );
      const clientId = created.client.id;
      await db.insert(billings).values([
        {
          id: "linked-billing",
          projectId: "alpha-project",
          clientId,
          tokenId: "near",
          amount: "1",
          proposalId: "linked",
        },
        {
          id: "unlinked-billing",
          projectId: "alpha-other",
          clientId,
          tokenId: "near",
          amount: "99",
          proposalId: "unlinked",
        },
      ]);
      const portal = createClientPortalService(
        access,
        {} as never,
        createBillingsService(db, directory),
        {} as never,
        directory,
        {} as never,
      );

      const listed = await run(
        portal.listBillings(
          { near: { primaryAccountId: "client.near" } },
          { agencyDaoAccountId: ALPHA, limit: 50 },
        ),
      );

      expect(listed.data.map((row) => row.projectId)).toEqual(["alpha-project"]);
    });

    test("a client with no linked projects sees none", async () => {
      const clientsService = createClientsService(db, directory);
      await run(
        clientsService.create(alpha, {
          orgId: "alpha-org",
          name: "Empty Corp",
          nearAccountId: "empty.near",
        }),
      );
      const portal = createClientPortalService(
        access,
        {} as never,
        createBillingsService(db, directory),
        {} as never,
        directory,
        {} as never,
      );
      const context = { near: { primaryAccountId: "empty.near" } };

      expect((await run(portal.listProjects(context, { agencyDaoAccountId: ALPHA }))).data).toEqual(
        [],
      );
      expect(
        (await run(portal.listBillings(context, { agencyDaoAccountId: ALPHA, limit: 50 }))).data,
      ).toEqual([]);
      await expect(
        run(portal.generateReport(context, { agencyDaoAccountId: ALPHA })),
      ).rejects.toThrow("No projects linked");
    });
  });
});
