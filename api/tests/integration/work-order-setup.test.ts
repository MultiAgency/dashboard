import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { workOrderIntegrations } from "../../src/db/schema";
import type { OrganizationScope } from "../../src/services/organization-access";
import type { FundingCheck } from "../../src/services/payouts/history";
import { createGoogleConnections } from "../../src/services/work-orders/google-oauth";
import { createWorkOrderIntegrations } from "../../src/services/work-orders/outbox";
import {
  createSetupStatus,
  type SetupCheck,
  type SetupStatusDeps,
} from "../../src/services/work-orders/setup-status";
import { type EngagementWorld, engagementWorld } from "../fakes/engagements";
import { migratedDatabase } from "./_pg";

const ORG = "studio";
const NEAR = 10n ** 24n;

describe("work order setup status", () => {
  const database = migratedDatabase({ perTest: true });
  let world: EngagementWorld;
  let integrations: ReturnType<typeof createWorkOrderIntegrations>;
  let agent: {
    connected: boolean;
    configured: boolean;
    readiness: { ready: boolean; code: string | null; reason: string | null };
    funding: FundingCheck | null;
    asked: { near: bigint; priceUsd: string | null } | null;
  };
  let name: string;
  let needs: { near: bigint; priceUsd: string | null };
  let scope: OrganizationScope;

  beforeEach(async () => {
    world = await engagementWorld(database.db);
    integrations = createWorkOrderIntegrations({ db: database.db });
    agent = {
      connected: false,
      configured: false,
      readiness: { ready: true, code: null, reason: null },
      funding: null,
      asked: null,
    };
    name = "test";
    needs = { near: 0n, priceUsd: null };
    scope = await world.manager("studio-admin", ORG);
  });

  function setup(over: Partial<SetupStatusDeps> = {}) {
    return createSetupStatus({
      organizationName: async () => name,
      representative: integrations.representative,
      emailEnabled: true,
      esignEnabled: true,
      google: {
        serviceAccount: false,
        connection: createGoogleConnections({ db: database.db, config: null }).status,
        settings: integrations.settings,
      },
      payouts: {
        connected: async () => agent.connected,
        configured: async () => agent.configured,
        readiness: async () => agent.readiness,
        fundingCheck: async (_organizationId, asked) => {
          agent.asked = asked;
          return agent.funding;
        },
      },
      fundingNeeds: async () => needs,
      ...over,
    });
  }

  const KEYS = [
    "agency_name",
    "representative",
    "email",
    "signing",
    "google",
    "payouts_agent",
    "payouts_funding",
  ] as const;

  const byKey = (checks: SetupCheck[]) =>
    Object.fromEntries(
      KEYS.map((key) => {
        const found = checks.find((c) => c.key === key);
        if (!found) throw new Error(`No ${key} check`);
        return [key, found];
      }),
    ) as Record<(typeof KEYS)[number], SetupCheck>;

  const funding = (over: Partial<FundingCheck> = {}): FundingCheck => ({
    balanceNear: "100",
    neededNear: "10.2",
    shortfallNear: "0",
    monthlyBudgetUsd: "5000",
    monthlyRemainingUsd: "5000",
    monthlyNeededUsd: "20.40",
    suggestedBudgetUsd: null,
    budgetTooLow: false,
    lowBalance: false,
    ...over,
  });

  function connectAgent() {
    agent.connected = true;
    agent.configured = true;
    agent.readiness = { ready: false, code: "payee_not_allowed", reason: "no payee" };
    agent.funding = funding();
  }

  async function connectDrive(choose: { template: boolean; folders: boolean }) {
    await integrations.saveGoogle(ORG, "studio-admin", {
      templateId: choose.template ? "template-1" : null,
      documentsFolderId: choose.folders ? "folder-1" : null,
      signedFolderId: choose.folders ? "folder-2" : null,
    });
    await database.db
      .update(workOrderIntegrations)
      .set({ googleOauthToken: "sealed", googleOauthEmail: "ops@studio.dev" })
      .where(eq(workOrderIntegrations.organizationId, ORG));
  }

  test("a fresh agency sees what's missing and where to fix it", async () => {
    const checks = await setup({ emailEnabled: false, esignEnabled: false }).checks(scope);
    expect(checks.map((c) => [c.key, c.state, c.required])).toEqual([
      ["agency_name", "missing", true],
      ["representative", "missing", true],
      ["email", "missing", true],
      ["signing", "warning", true],
      ["google", "optional", false],
      ["payouts_agent", "optional", false],
      ["payouts_funding", "optional", false],
    ]);
    const check = byKey(checks);
    expect(check.agency_name).toMatchObject({
      detail: "“test” looks like a placeholder; builders see it in every email and document",
      fixHref: "/admin/settings#organization",
    });
    expect(check.representative).toMatchObject({
      detail: "Add the default representative's name and email",
      fixHref: "/admin/settings#work-orders",
    });
    expect(check.signing.detail).toBe(
      "E-signature is off on this server. Builders accept the terms in MultiAgency.",
    );
    expect(check.google.fixHref).toBe("/admin/settings#work-orders");
    expect(check.payouts_agent.fixHref).toBe("/admin/settings#platform-agent");
  });

  test("a fully set-up agency is all ok", async () => {
    name = "Studio Nine";
    await integrations.saveRepresentative(ORG, "studio-admin", {
      name: "Rita",
      email: "rita@studio.dev",
    });
    await connectDrive({ template: true, folders: true });
    connectAgent();
    needs = { near: 10n * NEAR, priceUsd: "2" };

    const checks = await setup().checks(scope);
    expect(checks.every((c) => c.state === "ok")).toBe(true);
    expect(checks.every((c) => c.fixHref === null)).toBe(true);
    const check = byKey(checks);
    expect(check.representative.detail).toBe("Rita <rita@studio.dev>");
    expect(check.email.detail).toBe(
      "Builders get emails; agency emails go to the representative (rita@studio.dev)",
    );
    expect(check.google.detail).toBe("Connected as ops@studio.dev; template and folders chosen");
    expect(check.payouts_funding.detail).toBe(
      "Holds 100 NEAR, enough for the ≈10.2 NEAR active work orders need",
    );
    expect(agent.asked).toEqual({ near: (102n * NEAR) / 10n, priceUsd: "2" });
  });

  test("a placeholder email, half-chosen Drive and a nearly empty agent are flagged", async () => {
    name = "Studio Nine";
    await integrations.saveRepresentative(ORG, "studio-admin", {
      name: "Rita",
      email: "rita.near@near.email",
    });
    await connectDrive({ template: true, folders: false });
    connectAgent();
    agent.funding = funding({
      balanceNear: "0.0148",
      neededNear: "51",
      lowBalance: true,
      monthlyRemainingUsd: "10.00",
      monthlyNeededUsd: "102.00",
    });
    needs = { near: 50n * NEAR, priceUsd: "2" };

    const check = byKey(await setup().checks(scope));
    expect(check.representative).toMatchObject({
      state: "missing",
      detail: "rita.near@near.email is a placeholder address; agency emails would go nowhere",
    });
    expect(check.google).toMatchObject({
      state: "warning",
      detail: "Connected as ops@studio.dev; choose a documents folder and a signed folder",
    });
    expect(check.payouts_agent.state).toBe("ok");
    expect(check.payouts_funding).toMatchObject({
      state: "warning",
      detail:
        "Holds 0.0148 NEAR, active work orders need ≈51 NEAR. $10.00 left of this month's payout limit, active work orders need ≈$102.00",
      fixHref: "/admin/settings#platform-agent",
    });
  });

  test("an agent whose rules aren't applied is a warning", async () => {
    connectAgent();
    agent.readiness = {
      ready: false,
      code: "not_applied",
      reason: "The agent's rules aren't applied",
    };
    const check = byKey(await setup().checks(scope));
    expect(check.payouts_agent).toMatchObject({
      state: "warning",
      detail: "The agent's rules aren't applied",
    });
  });

  test("a connected agent without payouts in the consent is a warning, and its funding isn't checked", async () => {
    agent.connected = true;
    const check = byKey(await setup().checks(scope));
    expect(check.payouts_agent).toMatchObject({
      state: "warning",
      detail: "Connected, but the owner's consent doesn't include payouts",
    });
    expect(check.payouts_funding.state).toBe("optional");
    expect(agent.asked).toBeNull();
  });

  test("an agent paying in USDC leaves its funding to the platform card", async () => {
    connectAgent();
    agent.funding = null;
    const check = byKey(await setup().checks(scope));
    expect(check.payouts_funding).toMatchObject({
      state: "optional",
      detail: "Its balance is shown on the platform agent's card",
    });
  });

  test("a server without the platform pays by DAO proposal", async () => {
    const check = byKey(await setup({ payouts: null }).checks(scope));
    expect(check.payouts_agent).toMatchObject({
      state: "optional",
      detail: "Not on this server; requests are paid by DAO proposal",
    });
  });

  test("one failing check doesn't break the others", async () => {
    connectAgent();
    const checks = await setup({
      organizationName: async () => {
        throw new Error("directory down");
      },
      fundingNeeds: async () => {
        throw new Error("Couldn't get the NEAR price");
      },
    }).checks(scope);
    const check = byKey(checks);
    expect(check.agency_name).toMatchObject({
      state: "warning",
      detail: "Couldn't check: directory down",
      fixHref: "/admin/settings#organization",
    });
    expect(check.payouts_funding).toMatchObject({
      state: "warning",
      detail: "Couldn't check: Couldn't get the NEAR price",
    });
    expect(check.payouts_agent.state).toBe("ok");
    expect(checks).toHaveLength(7);
  });
});
