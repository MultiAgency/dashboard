import { beforeAll, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import { billings, compensationRequests, workOrderEvidence, workOrders } from "../../src/db/schema";
import { assessTrust, trustHistoryOf } from "../../src/services/work-orders/trust";
import { migratedDatabase } from "./_pg";

const ORG = "org-studio";
const CAROL = "carol.near";
const NOW = new Date("2026-10-23T12:00:00.000Z");

function order(id: string, overrides: Partial<typeof workOrders.$inferInsert> = {}) {
  return {
    id,
    code: id.toUpperCase(),
    organizationId: ORG,
    projectId: "proj-1",
    builderNearAccount: CAROL,
    title: "Build",
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    tokenId: "usdc",
    budgetAmount: "1000",
    status: "ended" as const,
    createdBy: "admin.near",
    ...overrides,
  };
}

function request(
  id: string,
  workOrderId: string,
  seq: number,
  overrides: Partial<typeof compensationRequests.$inferInsert> = {},
) {
  return {
    id,
    workOrderId,
    seq,
    coversFrom: "2026-05-01",
    coversTo: "2026-05-31",
    requestedAmount: "500",
    approvedAmount: "500",
    status: "paid" as const,
    contributionsMd: "",
    assessmentMd: "",
    submittedAt: new Date("2026-06-01T00:00:00.000Z"),
    decidedAt: new Date("2026-06-02T00:00:00.000Z"),
    paidAt: new Date("2026-06-03T00:00:00.000Z"),
    ...overrides,
  };
}

function evidence(
  id: string,
  workOrderId: string,
  overrides: Partial<typeof workOrderEvidence.$inferInsert> = {},
) {
  return {
    id,
    workOrderId,
    kind: "merged_pr" as const,
    url: `https://github.com/studio/app/pull/${id}`,
    title: id,
    state: "merged",
    authorized: true,
    occurredAt: new Date("2026-05-10T00:00:00.000Z"),
    ...overrides,
  };
}

describe("trustHistoryOf", () => {
  const database = migratedDatabase();
  let db: Database;

  beforeAll(async () => {
    db = database.db;
    await db.insert(workOrders).values([
      order("wo-a", {
        renewalStatus: "renewed",
        renewalAssessment: JSON.stringify({ passed: true }),
      }),
      order("wo-b", { periodStart: "2026-06-01", periodEnd: "2026-06-30", status: "active" }),
      order("wo-other-org", { organizationId: "org-other" }),
      order("wo-draft", { periodStart: "2026-01-01", status: "draft" }),
      order("wo-dave", { builderNearAccount: "dave.near" }),
    ]);
    await db.insert(workOrderEvidence).values([
      evidence("e1", "wo-a"),
      evidence("e2", "wo-a", {
        kind: "unlinked_pr",
        authorized: false,
        flags: JSON.stringify(["not approved by the repository owner (@owner)"]),
      }),
      evidence("e3", "wo-b", { occurredAt: new Date("2026-06-10T00:00:00.000Z") }),
      evidence("e4", "wo-b", {
        kind: "assigned_issue",
        authorized: false,
        occurredAt: new Date("2026-06-12T00:00:00.000Z"),
        flags: JSON.stringify(["assigned by the contractor themselves"]),
      }),
      evidence("e5", "wo-b", { occurredAt: new Date("2026-07-15T00:00:00.000Z") }),
      evidence("e-other", "wo-other-org"),
    ]);
    await db.insert(compensationRequests).values([
      request("r-a1", "wo-a", 1, { evidenceIds: JSON.stringify(["e1"]) }),
      request("r-b1", "wo-b", 1, { coversFrom: "2026-06-01", coversTo: "2026-06-30" }),
      request("r-b2", "wo-b", 2, {
        coversFrom: "2026-07-01",
        coversTo: "2026-07-31",
        status: "submitted",
        approvedAmount: null,
        paidAt: null,
        decidedAt: null,
      }),
      request("r-other", "wo-other-org", 1),
    ]);
  });

  test("reads only this builder's history in this organization", async () => {
    const history = await trustHistoryOf(db, ORG, CAROL);
    expect(history.builderNearAccount).toBe(CAROL);
    expect(history.firstWorkOrderStart).toBe("2026-05-01");
    expect(history.payeePaidBefore).toBe(true);
    expect(history.requests.map((r) => r.id).sort()).toEqual(["r-a1", "r-b1", "r-b2"]);
    expect(history.renewals).toEqual([{ workOrderId: "wo-a", status: "renewed", passed: true }]);
  });

  test("uses the request's frozen evidence ids when present, else the covered dates", async () => {
    const history = await trustHistoryOf(db, ORG, CAROL);
    const byId = new Map(history.requests.map((r) => [r.id, r]));
    expect(byId.get("r-a1")?.evidence).toEqual({
      authorized: 1,
      unauthorized: 0,
      flagged: 0,
      unapprovedPrs: 0,
      selfAssignedOnly: 0,
    });
    expect(byId.get("r-b1")?.evidence).toEqual({
      authorized: 1,
      unauthorized: 1,
      flagged: 1,
      unapprovedPrs: 0,
      selfAssignedOnly: 0,
    });
    expect(byId.get("r-b2")?.evidence.authorized).toBe(1);
    expect(byId.get("r-a1")?.paidAt).toBe("2026-06-03T00:00:00.000Z");
  });

  test("can exclude the request being assessed", async () => {
    const history = await trustHistoryOf(db, ORG, CAROL, { excludeRequestId: "r-b2" });
    expect(history.requests.map((r) => r.id).sort()).toEqual(["r-a1", "r-b1"]);
  });

  test("a builder with no work orders has empty history", async () => {
    const history = await trustHistoryOf(db, ORG, "nobody.near");
    expect(history).toEqual({
      builderNearAccount: "nobody.near",
      firstWorkOrderStart: null,
      payeePaidBefore: false,
      requests: [],
      renewals: [],
    });
  });

  test("a billing to the builder on an agency project counts as paid before", async () => {
    expect((await trustHistoryOf(db, ORG, "dave.near")).payeePaidBefore).toBe(false);
    await db.insert(billings).values({
      id: "bill-1",
      projectId: "proj-1",
      nearAccount: "dave.near",
      tokenId: "usdc",
      amount: "10",
      proposalId: "7",
    });
    expect((await trustHistoryOf(db, ORG, "dave.near")).payeePaidBefore).toBe(true);
  });

  test("feeds assessTrust: two clean periods make carol established", async () => {
    const history = await trustHistoryOf(db, ORG, CAROL, { excludeRequestId: "r-b2" });
    const result = assessTrust(
      history,
      {
        amount: "500",
        proratedCap: "500",
        remaining: "500",
        evidence: {
          authorized: 1,
          unauthorized: 0,
          flagged: 0,
          unapprovedPrs: 0,
          selfAssignedOnly: 0,
        },
        overlaps: [],
        payeeConfirmed: true,
      },
      { verdict: "consistent", concerns: [], confidence: 0.9 },
      { mode: "auto" },
      NOW,
    );
    expect(result.tier).toBe("established");
    expect(result.cleanPeriods).toBe(2);
    expect(result.decision).toBe("veto_window");
  });
});
