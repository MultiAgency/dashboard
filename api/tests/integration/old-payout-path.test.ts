import { beforeEach, describe, expect, test } from "vitest";
import { agentPayouts, payoutAgents, payoutIntents, platformAgents } from "../../src/db/schema";
import { createOldPayoutPath } from "../../src/services/platform/old-payout-path";
import { migratedDatabase } from "./_pg";

const NOW = new Date("2026-11-26T12:00:00.000Z");

describe("the old payout path, before it's removed", () => {
  const database = migratedDatabase({ perTest: true });
  let check: ReturnType<typeof createOldPayoutPath>;

  beforeEach(() => {
    check = createOldPayoutPath({
      db: database.db,
      organizationName: async (id) => (id === "studio" ? "Studio" : null),
      now: () => NOW,
    });
  });

  const oldAgent = (organizationId: string, grantExpiresAt: Date | null = null) =>
    database.db.insert(payoutAgents).values({
      organizationId,
      ownerAccountId: "rita.near",
      agentId: `agent-${organizationId}`,
      grantExpiresAt,
      monthlyBudgetUsd: "100",
      maxPayoutNear: "5",
      updatedBy: "admin",
    });

  const oldPayout = (
    organizationId: string,
    id: string,
    status: (typeof agentPayouts.$inferInsert)["status"],
    provenUnsent = false,
  ) =>
    database.db.insert(agentPayouts).values({
      id,
      organizationId,
      requestId: id,
      attempt: 1,
      status,
      idempotencyKey: id,
      requestBody: "{}",
      recipient: "carol.near",
      amount: "1",
      assetId: "nep141:wrap.near",
      provenUnsent,
    });

  const onPlatform = (organizationId: string) =>
    database.db.insert(platformAgents).values({
      organizationId,
      ownerAccountId: "rita.near",
      area: "payables",
      host: "platform.test",
      deployment: "multiagency-dashboard",
      agent: `own-${organizationId}`,
      payoutRoute: "platform",
      updatedBy: "admin",
    });

  test("nothing on the old path is drained", async () => {
    expect(await check()).toEqual({ drained: true, organizations: [] });
  });

  test("held, processing, unknown and unproven payouts block; paid, refused and proven-unsent ones don't", async () => {
    await oldAgent("studio");
    await onPlatform("studio");
    for (const [id, status, proven] of [
      ["paid", "paid", false],
      ["refused", "refused", true],
      ["failed-unsent", "failed", true],
      ["queued", "queued", false],
      ["processing", "processing", false],
      ["uncertain", "uncertain", false],
      ["needs-review", "needs_review", false],
      ["failed-unproven", "failed", false],
    ] as const) {
      await oldPayout("studio", id, status, proven);
    }
    const result = await check();
    expect(result.drained).toBe(false);
    expect(result.organizations).toEqual([
      expect.objectContaining({
        organizationId: "studio",
        name: "Studio",
        route: "platform",
        unsettledPayouts: 5,
        blockers: [
          "5 old-path payouts aren't settled (held, processing, unknown or waiting for a check)",
        ],
      }),
    ]);
  });

  test("an Organization still paying through the old agent, or with an old owner action in flight, blocks", async () => {
    await oldAgent("atelier", new Date("2027-01-01T00:00:00Z"));
    await database.db.insert(payoutIntents).values({
      correlationId: "intent-1",
      organizationId: "atelier",
      action: "issue_grant",
      intentType: "nep413",
      intent: "{}",
      signerAccountId: "rita.near",
      signerPublicKey: "ed25519:x",
      status: "PROCESSING",
    });
    const [atelier] = (await check()).organizations;
    expect(atelier).toMatchObject({
      route: "legacy",
      oldAgentId: "agent-atelier",
      ownerActionsInFlight: 1,
      grantLiveUntil: "2027-01-01T00:00:00.000Z",
    });
    expect(atelier?.blockers).toHaveLength(2);
    expect(atelier?.blockers.join(" ")).toMatch(/in flight on the old path/);
    expect(atelier?.blockers.join(" ")).toMatch(/still pays through the old payout agent/);
  });

  test("an Organization switched to the platform with everything settled is drained, a live old grant only noted", async () => {
    await oldAgent("studio", new Date("2027-01-01T00:00:00Z"));
    await onPlatform("studio");
    await oldPayout("studio", "paid", "paid");
    const result = await check();
    expect(result.drained).toBe(true);
    expect(result.organizations[0]).toMatchObject({
      blockers: [],
      grantLiveUntil: "2027-01-01T00:00:00.000Z",
    });
  });
});
