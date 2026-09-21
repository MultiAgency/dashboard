import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Effect } from "every-plugin/effect";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { budgets } from "../../src/db/schema";
import type { AgencyScope } from "../../src/lib/agency-scope";
import { runEffect } from "../../src/lib/context";
import { createOrganizationAccess } from "../../src/lib/organization-access";
import { createBudgetsService } from "../../src/services/budgets";
import { createEngagementsService } from "../../src/services/engagements";
import { createPrepaymentsService } from "../../src/services/prepayments";
import { createProjectDirectory } from "../../src/services/project-directory";
import { inMemoryOrganizationAccess } from "../fakes/organization-access";
import { inMemoryOrganizations } from "../fakes/organizations";
import { agencyScope, inMemoryProjects, orgScope, project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const ALPHA_DAO = "alpha.sputnik-dao.near";
const USDC = "usdc.near";

describe("prepayments", () => {
  let pg: PGlite;
  let db: Database;

  const alpha = agencyScope(ALPHA_DAO, { organizationId: "org-alpha" }) as AgencyScope;
  const acme = orgScope("org-acme");
  const acmeMember = orgScope("org-acme", { role: "member" });
  const stranger = orgScope("org-stranger");

  const { client } = inMemoryProjects([project("site", "org-alpha")]);
  const directory = createProjectDirectory(() => client);
  const orgs = inMemoryOrganizations([
    { id: "org-alpha", name: "Alpha", daoAccountId: ALPHA_DAO },
    { id: "org-acme", name: "Acme" },
  ]);
  const engagements = () =>
    createEngagementsService(
      db,
      directory,
      orgs.organizations,
      createOrganizationAccess(db, orgs.organizations, directory),
    );
  const prepayments = () => createPrepaymentsService(db, engagements());

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
  });

  beforeEach(async () => {
    await pg.query("TRUNCATE engagements, engagement_projects, prepayments, budgets CASCADE");
  });

  afterAll(async () => {
    await pg.close();
  });

  const run = <A, E>(effect: Effect.Effect<A, E>) => runEffect(effect);

  async function engagement() {
    const proposed = await run(engagements().propose(alpha, { clientOrganizationId: "org-acme" }));
    return run(engagements().accept(acme, proposed.id));
  }

  const september = { periodStart: "2026-09-01", periodEnd: "2026-09-30" };
  const october = { periodStart: "2026-10-01", periodEnd: "2026-10-31" };

  test("a Client sees the Prepayments its Agency recorded and its Prepaid balance", async () => {
    const { id } = await engagement();

    await run(
      prepayments().record(alpha, {
        engagementId: id,
        tokenId: USDC,
        amount: "1000",
        transferReference: "https://nearblocks.io/txns/abc",
        ...september,
      }),
    );
    const seen = await run(prepayments().list(acmeMember, id));

    expect(seen.data).toEqual([
      expect.objectContaining({
        tokenId: USDC,
        amount: "1000",
        periodStart: "2026-09-01",
        transferReference: "https://nearblocks.io/txns/abc",
      }),
    ]);
    expect(seen.balance).toEqual([{ tokenId: USDC, amount: "1000" }]);
  });

  test("the Prepaid balance rolls over and drops by Budget entries attributed to the Client", async () => {
    const { id } = await engagement();
    await run(
      prepayments().record(alpha, {
        engagementId: id,
        tokenId: USDC,
        amount: "1000",
        ...september,
      }),
    );
    await run(
      prepayments().record(alpha, { engagementId: id, tokenId: USDC, amount: "500", ...october }),
    );
    await db.insert(budgets).values([
      {
        id: "b1",
        projectId: "site",
        tokenId: USDC,
        amount: "700",
        actorAccountId: "x",
        engagementId: id,
      },
      {
        id: "b2",
        projectId: "site",
        tokenId: USDC,
        amount: "-200",
        actorAccountId: "x",
        engagementId: id,
      },
      { id: "b3", projectId: "site", tokenId: USDC, amount: "900", actorAccountId: "x" },
    ]);

    expect((await run(prepayments().list(acme, id))).balance).toEqual([
      { tokenId: USDC, amount: "1000" },
    ]);
  });

  test("the Agency corrects or removes a Prepayment recorded by mistake", async () => {
    const { id } = await engagement();
    const recorded = await run(
      prepayments().record(alpha, {
        engagementId: id,
        tokenId: USDC,
        amount: "1000",
        ...september,
      }),
    );

    await run(prepayments().correct(alpha, { id: recorded.id, amount: "900" }));
    expect((await run(prepayments().list(acme, id))).balance).toEqual([
      { tokenId: USDC, amount: "900" },
    ]);

    await run(prepayments().remove(alpha, recorded.id));
    expect((await run(prepayments().list(acme, id))).data).toEqual([]);
  });

  test("only the Agency of an active Engagement records Prepayments", async () => {
    const { id } = await engagement();
    const acmeAsAgency = agencyScope("acme.sputnik-dao.near", { organizationId: "org-acme" });

    await expect(
      run(
        prepayments().record(acmeAsAgency, {
          engagementId: id,
          tokenId: USDC,
          amount: "1",
          ...september,
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(run(prepayments().list(stranger, id))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    await run(engagements().end(alpha, id));
    await expect(
      run(
        prepayments().record(alpha, { engagementId: id, tokenId: USDC, amount: "1", ...september }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("every Budget entry records the Agency DAO it is funded from", async () => {
    const service = createBudgetsService(
      db,
      directory,
      inMemoryOrganizationAccess(orgs.organizations, directory),
    );

    const { budget } = await run(
      service.create(alpha, { projectId: "site", tokenId: USDC, amount: "10" }),
    );

    expect(budget.daoAccountId).toBe(ALPHA_DAO);
  });
});
