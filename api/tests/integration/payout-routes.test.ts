import { createPluginRuntime } from "every-plugin";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { FakeAgentApi } from "../fakes/agent-api";

const fake = vi.hoisted(() => ({ api: null as FakeAgentApi | null }));

vi.mock("@near-intents-agent-api/sdk", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  AgentApi: vi.fn(function agentApi() {
    return fake.api;
  }),
}));

vi.mock("../../src/services/sputnik", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getRoles: async () => [],
  getProposalBond: async () => "100000000000000000000000",
  fullAccessKeys: async () => (fake.api ? [fake.api.ownerKey] : []),
}));

const PLUGIN = "api";
const ORG = "studio";
const DAO = "studio.sputnik-dao.near";
const OTHER_ORG = "atelier";
const OTHER_DAO = "atelier.sputnik-dao.near";

function caller(role: "owner" | "member" | null, platformAdmin = false, org = ORG) {
  if (role === null && !platformAdmin) return {};
  return {
    userId: "user-1",
    user: { id: "user-1", role: platformAdmin ? "admin" : "user" },
    reqHeaders: new Headers(),
    organization: role
      ? {
          activeOrganizationId: org,
          organization: { id: org, name: org, slug: org, metadata: null },
          member: { role },
        }
      : null,
  };
}

describe("payout routes through the plugin runtime", () => {
  let runtime: ReturnType<typeof createPluginRuntime>;
  let clientFor: (context: object) => any;

  beforeAll(async () => {
    const { FakeAgentApi } = await import("../fakes/agent-api");
    fake.api = new FakeAgentApi();
    runtime = createPluginRuntime({
      registry: { [PLUGIN]: { module: (await import("../../src/index")).default } },
    } as any);
    const plugin = await (runtime as any).usePlugin(PLUGIN, {
      variables: {},
      secrets: {
        API_DATABASE_URL: ":memory:",
        NEAR_INTENTS_AGENT_API_KEY: "naa_test",
        PAYOUTS_SECRET_KEY: "test-secret",
      },
    });
    clientFor = (context) => plugin.createClient(context);
    await clientFor(caller(null, true)).agencyDao.connect({
      daoAccountId: DAO,
      organizationId: ORG,
    });
    await clientFor(caller(null, true)).agencyDao.connect({
      daoAccountId: OTHER_DAO,
      organizationId: OTHER_ORG,
    });
  }, 120_000);

  afterAll(async () => {
    await runtime?.shutdown();
  });

  const calls: Array<[string, (client: any) => Promise<unknown>]> = [
    ["payoutAgent", (c) => c.workOrders.payoutAgent({})],
    [
      "savePayoutAgent",
      (c) =>
        c.workOrders.savePayoutAgent({
          ownerAccountId: "rita.near",
          monthlyBudgetUsd: "5000",
          maxPayoutNear: "500",
        }),
    ],
    ["preparePayoutAction", (c) => c.workOrders.preparePayoutAction({ action: "issue_grant" })],
    [
      "submitPayoutAction",
      (c) => c.workOrders.submitPayoutAction({ correlationId: "none", signedData: {} }),
    ],
    ["allowPayees", (c) => c.workOrders.allowPayees({})],
    ["payoutFunding", (c) => c.workOrders.payoutFunding({})],
    ["payoutTopUp", (c) => c.workOrders.payoutTopUp({ amountNear: "1" })],
  ];

  test.each(calls)("%s refuses a caller who isn't signed in", async (_name, call) => {
    await expect(call(clientFor(caller(null)))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  test.each(calls)("%s refuses an Organization member who isn't a manager", async (_name, call) => {
    await expect(call(clientFor(caller("member")))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("an owner sets up the payout agent through the routes", async () => {
    const owner = clientFor(caller("owner"));
    const api = fake.api!;

    expect(await owner.workOrders.payoutAgent({})).toMatchObject({
      available: true,
      agentId: null,
    });

    const saved = await owner.workOrders.savePayoutAgent({
      ownerAccountId: "rita.near",
      monthlyBudgetUsd: "5000",
      maxPayoutNear: "500",
    });
    expect(saved.settings).toMatchObject({ ownerAccountId: "rita.near" });

    const create = await owner.workOrders.preparePayoutAction({
      action: "create_agent",
      publicKey: api.ownerKey,
    });
    expect(create).toMatchObject({ action: "create_agent", signerAccountId: "rita.near" });

    const created = await owner.workOrders.submitPayoutAction({
      correlationId: create.correlationId,
      signedData: await api.sign(create.intent),
    });
    expect(created.view.agentId).toBe(api.agentId);

    const grant = await owner.workOrders.preparePayoutAction({ action: "issue_grant" });
    const granted = await owner.workOrders.submitPayoutAction({
      correlationId: grant.correlationId,
      signedData: await api.sign(grant.intent),
    });
    expect(granted.view.grantValid).toBe(true);

    expect(await owner.workOrders.allowPayees({})).toMatchObject({ ok: true });

    expect(await owner.workOrders.payoutFunding({})).toMatchObject({
      items: [],
      neededNear: "0",
    });

    expect(await owner.workOrders.payoutTopUp({ amountNear: "1" })).toMatchObject({
      address: "deposit.near",
      daoAccountId: DAO,
      method: "add_proposal",
      deposit: "100000000000000000000000",
    });
  });

  test.each(
    calls,
  )("%s refuses a member of another Organization with its own Agency DAO", async (_name, call) => {
    await expect(call(clientFor(caller("member", false, OTHER_ORG)))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("each Organization's routes act on its own payout agent, whatever the input names", async () => {
    const other = clientFor(caller("owner", false, OTHER_ORG));
    expect((await other.workOrders.payoutAgent({})).settings).toBeNull();

    await other.workOrders.savePayoutAgent({
      ownerAccountId: "otto.near",
      monthlyBudgetUsd: "10",
      maxPayoutNear: "1",
      organizationId: ORG,
    } as never);

    expect((await other.workOrders.payoutAgent({})).settings).toMatchObject({
      ownerAccountId: "otto.near",
    });
    expect((await clientFor(caller("owner")).workOrders.payoutAgent({})).settings).toMatchObject({
      ownerAccountId: "rita.near",
    });
    await expect(other.workOrders.payoutTopUp({ amountNear: "1" })).rejects.toMatchObject({
      message: "Create the payout agent first",
    });
  });
});
