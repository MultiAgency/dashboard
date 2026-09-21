import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Effect } from "every-plugin/effect";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { billings } from "../../src/db/schema";
import type { AgencyScope } from "../../src/lib/agency-scope";
import { runEffect } from "../../src/lib/context";
import { createOrganizationAccess } from "../../src/lib/organization-access";
import { type ChangeOrderEvent, createChangeOrdersService } from "../../src/services/change-orders";
import { createEngagementsService } from "../../src/services/engagements";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { createPrepaymentsService } from "../../src/services/prepayments";
import { createProjectDirectory } from "../../src/services/project-directory";
import { inMemoryOrganizations } from "../fakes/organizations";
import { agencyScope, inMemoryProjects, orgScope, project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const ALPHA_DAO = "alpha.sputnik-dao.near";
const USDC = "usdc.near";

describe("change orders and the allocation plan", () => {
  let pg: PGlite;
  let db: Database;
  let today = new Date("2026-09-10T12:00:00Z");
  let events: ChangeOrderEvent[] = [];

  const alpha = agencyScope(ALPHA_DAO, { organizationId: "org-alpha" }) as AgencyScope;
  const acme = orgScope("org-acme");

  const { client } = inMemoryProjects([
    project("site", "org-alpha"),
    project("app", "org-alpha"),
    project("internal", "org-alpha"),
  ]);
  const directory = createProjectDirectory(() => client);
  const orgs = inMemoryOrganizations([
    { id: "org-alpha", name: "Alpha", daoAccountId: ALPHA_DAO },
    { id: "org-acme", name: "Acme" },
  ]);

  function services() {
    const access = createOrganizationAccess(db, orgs.organizations, directory);
    const engagements = createEngagementsService(db, directory, orgs.organizations, access);
    const listings = createListingsService(db, directory);
    const changeOrders = createChangeOrdersService(db, {
      engagements,
      directory,
      ledgers: createProjectLedgers(db, listings),
      access,
      notify: async (event) => {
        events.push(event);
      },
      now: () => today,
    });
    const prepayments = createPrepaymentsService(db, engagements, changeOrders.applyPeriod);
    return { engagements, changeOrders, prepayments };
  }

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
  });

  beforeEach(async () => {
    await pg.query(
      "TRUNCATE engagements, engagement_projects, prepayments, budgets, billings, change_orders, allocation_plans, organization_daos CASCADE",
    );
    today = new Date("2026-09-10T12:00:00Z");
    events = [];
  });

  afterAll(async () => {
    await pg.close();
  });

  const run = <A, E>(effect: Effect.Effect<A, E>) => runEffect(effect);

  async function engagement() {
    const { engagements } = services();
    const proposed = await run(engagements.propose(alpha, { clientOrganizationId: "org-acme" }));
    const accepted = await run(engagements.accept(acme, proposed.id));
    for (const projectId of ["site", "app"]) {
      await run(engagements.share(alpha, { engagementId: accepted.id, projectId }));
    }
    return accepted.id;
  }

  const prepay = (engagementId: string, amount: string, month = "09") => {
    const end = month === "09" ? "30" : "31";
    return run(
      services().prepayments.record(alpha, {
        engagementId,
        tokenId: USDC,
        amount,
        periodStart: `2026-${month}-01`,
        periodEnd: `2026-${month}-${end}`,
      }),
    );
  };

  const balance = async (engagementId: string) =>
    (await run(services().prepayments.list(acme, engagementId))).balance;

  const attributed = async (engagementId: string) =>
    (
      await pg.query<{ project_id: string; total: string }>(
        `SELECT project_id, sum(amount::numeric)::text AS total FROM budgets
         WHERE engagement_id = $1 GROUP BY project_id ORDER BY project_id`,
        [engagementId],
      )
    ).rows.map((r) => [r.project_id, r.total]);

  const plan = [
    { projectId: "site", tokenId: USDC, amount: "600" },
    { projectId: "app", tokenId: USDC, amount: "600" },
  ];

  test("the Agency proposes the first Allocation plan and it starts next month once approved", async () => {
    const id = await engagement();
    const { changeOrders } = services();

    const proposed = await run(changeOrders.propose(alpha, { engagementId: id, plan }));
    await run(changeOrders.approve(acme, proposed.id));
    const current = await run(changeOrders.plan(acme, id));

    expect(current).toMatchObject({
      effectiveFrom: "2026-10-01",
      lines: [
        { projectId: "site", tokenId: USDC, amount: "600" },
        { projectId: "app", tokenId: USDC, amount: "600" },
      ],
    });
    await prepay(id, "2000");
    expect(await attributed(id)).toEqual([]);
  });

  test("recording a Prepayment applies the plan once per period, skipping lines that don't fit", async () => {
    const id = await engagement();
    const { changeOrders } = services();
    const proposed = await run(
      changeOrders.propose(alpha, { engagementId: id, plan, effective: "now" }),
    );
    await run(changeOrders.approve(acme, proposed.id));

    const first = await prepay(id, "1000");
    expect(first.shortfall).toEqual([{ projectId: "app", tokenId: USDC, amount: "600" }]);
    expect(await attributed(id)).toEqual([["site", "600"]]);

    await prepay(id, "500");
    expect(await attributed(id)).toEqual([
      ["app", "600"],
      ["site", "600"],
    ]);
    expect(await balance(id)).toEqual([{ tokenId: USDC, amount: "300" }]);
    expect(events.map((e) => e.type)).toContain("plan.shortfall");
  });

  test("a plan changed mid-period does not apply twice to that period", async () => {
    const id = await engagement();
    const { changeOrders } = services();
    await run(
      changeOrders.approve(
        acme,
        (await run(changeOrders.propose(alpha, { engagementId: id, plan, effective: "now" }))).id,
      ),
    );
    await prepay(id, "1200");

    const replacement = await run(
      changeOrders.propose(acme, {
        engagementId: id,
        plan: [{ projectId: "site", tokenId: USDC, amount: "100" }],
        effective: "now",
      }),
    );
    await run(changeOrders.approve(alpha, replacement.id));
    await prepay(id, "100");

    expect(await attributed(id)).toEqual([
      ["app", "600"],
      ["site", "600"],
    ]);
  });

  test("only the other side decides and the proposer can withdraw", async () => {
    const id = await engagement();
    const { changeOrders } = services();
    const proposed = await run(changeOrders.propose(acme, { engagementId: id, plan }));

    await expect(run(changeOrders.approve(acme, proposed.id))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(run(changeOrders.withdraw(alpha, proposed.id))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const withdrawn = await run(changeOrders.withdraw(acme, proposed.id));
    expect(withdrawn.status).toBe("withdrawn");

    const again = await run(changeOrders.propose(acme, { engagementId: id, plan }));
    expect((await run(changeOrders.reject(alpha, again.id))).status).toBe("rejected");
    expect(events.map((e) => [e.type, e.to])).toEqual([
      ["change_order.proposed", "agency"],
      ["change_order.withdrawn", "agency"],
      ["change_order.proposed", "agency"],
      ["change_order.rejected", "client"],
    ]);
  });

  test("a Client moves prepaid money into a Project right away when the Agency agrees", async () => {
    const id = await engagement();
    await prepay(id, "1000");
    const { changeOrders } = services();

    const proposed = await run(
      changeOrders.propose(acme, {
        engagementId: id,
        moves: [{ projectId: "site", tokenId: USDC, amount: "300" }],
        effective: "now",
      }),
    );
    const approved = await run(changeOrders.approve(alpha, proposed.id));

    expect(approved).toMatchObject({ status: "approved", appliedAt: expect.any(Date) });
    expect(await attributed(id)).toEqual([["site", "300"]]);
    expect(await balance(id)).toEqual([{ tokenId: USDC, amount: "700" }]);
  });

  test("moves approved for next period wait for the next Prepayment", async () => {
    const id = await engagement();
    await prepay(id, "1000");
    const { changeOrders } = services();
    const proposed = await run(
      changeOrders.propose(acme, {
        engagementId: id,
        moves: [{ projectId: "app", tokenId: USDC, amount: "400" }],
      }),
    );
    await run(changeOrders.approve(alpha, proposed.id));
    expect(await attributed(id)).toEqual([]);

    today = new Date("2026-10-02T09:00:00Z");
    await prepay(id, "100", "10");

    expect(await attributed(id)).toEqual([["app", "400"]]);
  });

  test("limits are rechecked when a Change order is applied", async () => {
    const id = await engagement();
    await prepay(id, "1000");
    const { changeOrders } = services();
    const move = (projectId: string, amount: string) =>
      run(
        changeOrders.propose(acme, {
          engagementId: id,
          moves: [{ projectId, tokenId: USDC, amount }],
          effective: "now",
        }),
      );

    const big = await move("site", "800");
    const small = await move("app", "300");
    await run(changeOrders.approve(alpha, big.id));
    await expect(run(changeOrders.approve(alpha, small.id))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Prepaid balance"),
    });

    await db.insert(billings).values({
      id: "bill-1",
      projectId: "site",
      tokenId: USDC,
      amount: "700",
      proposalId: "pending-1",
    });
    const pullBack = await move("site", "-200");
    await expect(run(changeOrders.approve(alpha, pullBack.id))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await attributed(id)).toEqual([["site", "800"]]);
    expect(await balance(id)).toEqual([{ tokenId: USDC, amount: "200" }]);
  });

  test("Change orders only touch Projects shared through an active Engagement", async () => {
    const id = await engagement();
    const { changeOrders, engagements } = services();

    await expect(
      run(
        changeOrders.propose(acme, {
          engagementId: id,
          moves: [{ projectId: "internal", tokenId: USDC, amount: "1" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await run(engagements.end(alpha, id));
    await expect(run(changeOrders.propose(acme, { engagementId: id, plan }))).rejects.toMatchObject(
      { code: "BAD_REQUEST" },
    );
  });
});
