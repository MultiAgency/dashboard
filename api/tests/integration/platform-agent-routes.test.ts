import { createPluginRuntime } from "every-plugin";
import { generateKey } from "near-kit";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { FakePlatformApp } from "../fakes/platform-app";

const fake = vi.hoisted(() => ({ platform: null as FakePlatformApp | null, created: 0 }));

vi.mock("../../src/services/platform/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createPlatformApp: () => {
    fake.created += 1;
    if (!fake.platform) throw new Error("no fake platform");
    return fake.platform.client();
  },
}));

vi.mock("../../src/services/sputnik", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getRoles: async () => [],
}));

vi.mock("../../src/services/organization-approvals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/organization-approvals")>();
  return {
    ...actual,
    createOrganizationApprovals: (
      ...args: Parameters<typeof actual.createOrganizationApprovals>
    ) => ({
      ...actual.createOrganizationApprovals(...args),
      isApproved: async () => true,
    }),
  };
});

const PLUGIN = "api";
const ORG = "studio";
const OTHER_ORG = "atelier";
const HOST = "platform.test";
const CREDENTIAL = "tap_credential.secret";

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

async function start(secrets: Record<string, string>) {
  const runtime = createPluginRuntime({
    registry: { [PLUGIN]: { module: (await import("../../src/index")).default } },
  } as any);
  const plugin = await (runtime as any).usePlugin(PLUGIN, {
    variables: {},
    secrets: { API_DATABASE_URL: ":memory:", ...secrets },
  });
  const clientFor = (context: object): any => plugin.createClient(context);
  for (const [organizationId, dao] of [
    [ORG, "studio.sputnik-dao.near"],
    [OTHER_ORG, "atelier.sputnik-dao.near"],
  ]) {
    await clientFor(caller(null, true)).agencyDao.connect({ daoAccountId: dao, organizationId });
  }
  return { runtime, clientFor };
}

const calls: Array<[string, (client: any) => Promise<unknown>]> = [
  ["view", (c) => c.platformAgent.view({})],
  ["startSetup", (c) => c.platformAgent.startSetup({ ownerAccountId: "rita.near" })],
  ["startConsent", (c) => c.platformAgent.startConsent({ days: 90 })],
  [
    "submitSigned",
    (c) =>
      c.platformAgent.submitSigned({
        message: "x",
        nonce: "x",
        publicKey: generateKey().publicKey.toString(),
        signature: "x",
      }),
  ],
  ["retry", (c) => c.platformAgent.retry({})],
  ["prepareCreate", (c) => c.platformAgent.prepareCreate({})],
  ["submitCreate", (c) => c.platformAgent.submitCreate({ correlationId: "x", signedData: {} })],
  ["followCreate", (c) => c.platformAgent.followCreate({})],
  ["disconnect", (c) => c.platformAgent.disconnect({})],
  ["overview", (c) => c.platformAgent.overview({})],
  ["unresolved", (c) => c.platformAgent.unresolved({})],
  ["activity", (c) => c.platformAgent.activity({})],
  ["ledger", (c) => c.platformAgent.ledger({})],
  ["policyHistory", (c) => c.platformAgent.policyHistory({})],
  ["ownerActions", (c) => c.platformAgent.ownerActions({})],
  ["ownerView", (c) => c.platformAgent.ownerView({})],
  [
    "saveRules",
    (c) =>
      c.platformAgent.saveRules({
        asset: "wnear",
        maxPerPayout: "50",
        monthlyBudgetUsd: "500",
        ownerApproval: false,
      }),
  ],
  ["prepareAction", (c) => c.platformAgent.prepareAction({ kind: "grant" })],
  ["submitAction", (c) => c.platformAgent.submitAction({ correlationId: "x", signedData: {} })],
  ["followAction", (c) => c.platformAgent.followAction({ correlationId: "x" })],
  ["deposit", (c) => c.platformAgent.deposit({})],
  ["fundAgent", (c) => c.platformAgent.fundAgent({})],
  [
    "setPayoutRoute",
    (c) => c.platformAgent.setPayoutRoute({ organizationId: "studio", route: "platform" }),
  ],
];

describe("platform agent routes, turned off", () => {
  let runtime: ReturnType<typeof createPluginRuntime>;
  let clientFor: (context: object) => any;

  beforeAll(async () => {
    const { FakePlatformApp } = await import("../fakes/platform-app");
    fake.platform = new FakePlatformApp({ host: HOST, deployment: "multiagency-dashboard" });
    fake.created = 0;
    ({ runtime, clientFor } = await start({
      PLATFORM_URL: `https://${HOST}`,
      PLATFORM_DEPLOYMENT: "multiagency-dashboard",
    }));
  }, 120_000);

  afterAll(async () => {
    await runtime?.shutdown();
  });

  test("with a setting missing, the view says so and no client is built", async () => {
    expect(await clientFor(caller("owner")).platformAgent.view({})).toMatchObject({
      available: false,
      state: "off",
    });
    await expect(
      clientFor(caller("owner")).platformAgent.startSetup({ ownerAccountId: "rita.near" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fake.created).toBe(0);
    expect(fake.platform?.calls).toEqual([]);
  });
});

describe("platform agent routes", () => {
  let runtime: ReturnType<typeof createPluginRuntime>;
  let clientFor: (context: object) => any;

  beforeAll(async () => {
    const { FakePlatformApp } = await import("../fakes/platform-app");
    fake.platform = new FakePlatformApp({ host: HOST, deployment: "multiagency-dashboard" });
    ({ runtime, clientFor } = await start({
      PLATFORM_URL: `https://${HOST}`,
      PLATFORM_DEPLOYMENT: "multiagency-dashboard",
      PLATFORM_APP_CREDENTIAL: CREDENTIAL,
    }));
  }, 120_000);

  afterAll(async () => {
    await runtime?.shutdown();
  });

  test.each(calls)("%s refuses a caller who isn't signed in", async (_name, call) => {
    await expect(call(clientFor(caller(null)))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  test.each(calls)("%s refuses an Organization member who isn't a manager", async (_name, call) => {
    await expect(call(clientFor(caller("member")))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("an owner connects through the routes, and no answer carries the credential", async () => {
    const owner = clientFor(caller("owner"));
    const answers: unknown[] = [];
    const keep = <T>(answer: T) => {
      answers.push(answer);
      return answer;
    };
    const key = generateKey().publicKey.toString();

    const setup = keep(await owner.platformAgent.startSetup({ ownerAccountId: "Rita.near" }));
    expect(setup.ownerAccountId).toBe("rita.near");
    const creating = keep(
      await owner.platformAgent.submitSigned({
        message: setup.signing.message,
        nonce: setup.signing.nonce,
        publicKey: key,
        signature: "c2V0dXA=",
      }),
    );
    expect(creating.state).toBe("creating");
    const prepared = keep(await owner.platformAgent.prepareCreate({}));
    expect(prepared.view.create.confirmUrl).toMatch(/^https:\/\/platform\.test\/confirm\//);
    fake.platform?.confirmCreate(creating.agent);
    const consent = keep(await owner.platformAgent.startConsent({ days: 90 }));
    const connected = keep(
      await owner.platformAgent.submitSigned({
        message: consent.signing.message,
        nonce: consent.signing.nonce,
        publicKey: key,
        signature: "Y29uc2VudA==",
      }),
    );
    expect(connected.state).toBe("connected");
    keep(await owner.platformAgent.overview({}));
    keep(await owner.platformAgent.ownerView({}));
    expect(JSON.stringify(answers)).not.toContain("tap_");

    const other = clientFor(caller("owner", false, OTHER_ORG));
    expect((await other.platformAgent.view({})).state).toBe("not_connected");
    await expect(other.platformAgent.overview({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
