import { beforeEach, describe, expect, test } from "vitest";
import { billings, budgets } from "../../src/db/schema";
import type { OrganizationScope } from "../../src/services/organization-access";
import { createWorkOrdersService, type WorkOrderInput } from "../../src/services/work-orders";
import { migratedDatabase } from "./_pg";

const USDC = "usdc.near";

const scopeOf = (platformAdmin = true): OrganizationScope => ({
  organizationId: "studio",
  agencyDao: "studio.sputnik-dao.near",
  network: "mainnet",
  role: "owner",
  actorId: "owner.near",
  canSeePrivate: true,
  pluginContext: { userId: platformAdmin ? "platform" : "manager" },
});

const order = (overrides: Partial<WorkOrderInput> = {}): WorkOrderInput => ({
  nearAccount: "ada.near",
  status: "signed",
  startsOn: "2026-10-01",
  endsOn: "2026-12-31",
  lines: [{ projectId: "site", tokenId: USDC, amount: "1000" }],
  ...overrides,
});

describe("work orders", () => {
  const state = migratedDatabase();
  const approvedProposals = new Set<string>();
  let today = new Date("2026-10-10T12:00:00Z");

  beforeEach(async () => {
    await state.pg.query("TRUNCATE work_orders, work_order_lines, billings, budgets CASCADE");
    approvedProposals.clear();
    today = new Date("2026-10-10T12:00:00Z");
  });

  function service(options: { agreements?: string[] } = {}) {
    return createWorkOrdersService({
      db: state.db,
      isPlatformAdmin: (scope) => scope.pluginContext.userId === "platform",
      projectsOf: async () => [
        { id: "site", title: "Website" },
        { id: "app", title: "App" },
      ],
      accountsOf: async (_scope, nearAccount) =>
        nearAccount === "ada.near" ? ["ada.near", "ada-payouts.near"] : [nearAccount],
      agreementOnFile: async () => (account) => (options.agreements ?? []).includes(account),
      approved: async (_scope, rows) => rows.map((r) => approvedProposals.has(r.proposalId)),
      now: () => today,
    });
  }

  async function bill(
    proposalId: string,
    values: { projectId?: string; nearAccount?: string; amount: string; at: string },
    approved = true,
  ) {
    await state.db.insert(billings).values({
      id: `b-${proposalId}`,
      projectId: values.projectId ?? "site",
      nearAccount: values.nearAccount ?? "ada.near",
      tokenId: USDC,
      amount: values.amount,
      proposalId,
      payingDaoAccountId: "studio.sputnik-dao.near",
      createdAt: new Date(values.at),
    });
    if (approved) approvedProposals.add(proposalId);
  }

  async function budget(projectId: string, amount: string) {
    await state.db.insert(budgets).values({
      id: `budget-${projectId}-${amount}`,
      projectId,
      tokenId: USDC,
      amount,
      actorAccountId: "owner.near",
    });
  }

  test("only a platform admin sees or records work orders", async () => {
    const manager = scopeOf(false);

    await expect(service().list(manager)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service().create(manager, order())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test.each([
    [
      "a Project outside the Agency",
      order({ lines: [{ projectId: "other", tokenId: USDC, amount: "1" }] }),
    ],
    ["an end before the start", order({ startsOn: "2026-12-31", endsOn: "2026-10-01" })],
    ["a zero amount", order({ lines: [{ projectId: "site", tokenId: USDC, amount: "0" }] })],
    [
      "the same Project and token twice",
      order({
        lines: [
          { projectId: "site", tokenId: USDC, amount: "1" },
          { projectId: "site", tokenId: USDC, amount: "2" },
        ],
      }),
    ],
  ])("refuses %s", async (_name, input) => {
    await expect(service().create(scopeOf(), input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("allows one active work order per contributor and Project", async () => {
    await service().create(scopeOf(), order());

    await expect(service().create(scopeOf(), order())).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(service().create(scopeOf(), order({ status: "draft" }))).resolves.toBeDefined();
  });

  test("counts approved payouts to any of the contributor's accounts since the start", async () => {
    await budget("site", "5000");
    await bill("1", { amount: "300", at: "2026-10-02T00:00:00Z" });
    await bill("2", { amount: "200", nearAccount: "ada-payouts.near", at: "2026-10-05T00:00:00Z" });
    await bill("3", { amount: "999", at: "2026-10-06T00:00:00Z" }, false);
    await bill("4", { amount: "999", at: "2026-09-20T00:00:00Z" });
    await bill("5", { amount: "999", projectId: "app", at: "2026-10-06T00:00:00Z" });
    await bill("6", { amount: "999", nearAccount: "bob.near", at: "2026-10-06T00:00:00Z" });

    const { data } = await service().create(scopeOf(), order());

    expect(data.lines[0]).toMatchObject({ paid: "500", remaining: "500", warnings: [] });
  });

  test("still counts a payout recorded after the end date while the work order is open", async () => {
    await budget("site", "5000");
    await bill("1", { amount: "400", at: "2027-01-10T00:00:00Z" });

    const { data } = await service().create(scopeOf(), order());

    expect(data.lines[0]?.paid).toBe("400");
  });

  test("stops counting once the work order is completed", async () => {
    await budget("site", "5000");
    today = new Date("2026-11-01T00:00:00Z");
    const created = await service().create(scopeOf(), order({ status: "completed" }));
    await bill("1", { amount: "400", at: "2026-12-01T00:00:00Z" });

    const { data } = await service().list(scopeOf());

    expect(data.find((o) => o.id === created.data.id)?.lines[0]?.paid).toBe("0");
  });

  test("warns about overpayment, budget, ending soon and a missing agreement", async () => {
    await budget("site", "800");
    await bill("1", { amount: "1200", at: "2026-10-02T00:00:00Z" });
    today = new Date("2026-12-25T00:00:00Z");

    const { data } = await service().create(scopeOf(), order());

    expect(data.lines[0]?.warnings).toEqual(["overpaid", "overBudget"]);
    expect(data.warnings).toEqual(["overpaid", "overBudget", "endingSoon", "noAgreement"]);
  });

  test("doesn't warn about the agreement when one is on file for a payout account", async () => {
    await budget("site", "5000");

    const { data } = await service({ agreements: ["ada-payouts.near"] }).create(scopeOf(), order());

    expect(data.warnings).toEqual([]);
  });

  test("deletes only drafts", async () => {
    const signed = await service().create(scopeOf(), order());
    const draft = await service().create(
      scopeOf(),
      order({ status: "draft", lines: [{ projectId: "app", tokenId: USDC, amount: "1" }] }),
    );

    await expect(service().remove(scopeOf(), { id: signed.data.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(service().remove(scopeOf(), { id: draft.data.id })).resolves.toEqual({ ok: true });
  });

  test("lists approved payouts that no work order covers", async () => {
    await service().create(scopeOf(), order());
    await bill("covered", { amount: "100", at: "2026-10-02T00:00:00Z" });
    await bill("other-project", { amount: "100", projectId: "app", at: "2026-10-03T00:00:00Z" });
    await bill("someone-else", {
      amount: "100",
      nearAccount: "bob.near",
      at: "2026-10-04T00:00:00Z",
    });
    await bill(
      "pending",
      { amount: "100", nearAccount: "bob.near", at: "2026-10-05T00:00:00Z" },
      false,
    );

    const { data } = await service().uncoveredPayouts(scopeOf());

    expect(data.map((p) => p.billingId)).toEqual(["b-someone-else", "b-other-project"]);
  });
});
