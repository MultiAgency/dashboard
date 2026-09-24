import { createPluginRuntime } from "every-plugin";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import Plugin from "../src/index";

const PLUGIN_ID = "@everything-dev/builders-plugin";

type Caller = { userId: string; near?: string; platformAdmin?: boolean };

function contextOf(caller: Caller) {
  return {
    userId: caller.userId,
    user: { id: caller.userId, role: caller.platformAdmin ? "admin" : "user" },
    near: caller.near ? { primaryAccountId: caller.near } : undefined,
    organization: {
      activeOrganizationId: "acme",
      organization: { id: "acme", name: "acme", slug: "acme", metadata: {} },
      member: { id: `acme:${caller.userId}`, role: "owner" },
    },
  };
}

const agencyAdmin: Caller = { userId: "agency-admin", near: "agency-admin.near" };
const otherAgencyAdmin: Caller = { userId: "other-admin", near: "other-admin.near" };
const platformAdmin: Caller = { userId: "platform", platformAdmin: true };

let counter = 0;
const nextAccount = () => `builder-${++counter}.near`;

describe("builders plugin permissions", () => {
  let runtime: ReturnType<typeof createPluginRuntime>;
  let clientFor: (caller: Caller) => any;
  let anonymousClient: () => any;

  beforeAll(async () => {
    runtime = createPluginRuntime({ registry: { [PLUGIN_ID]: { module: Plugin } } } as any);
    const plugin = await (runtime as any).usePlugin(PLUGIN_ID, {
      variables: {},
      secrets: { BUILDERS_DATABASE_URL: ":memory:" },
    });
    clientFor = (caller) => plugin.createClient(contextOf(caller));
    anonymousClient = () => plugin.createClient({});
  });

  afterAll(async () => {
    await runtime.shutdown();
  });

  const nameOf = async (nearAccount: string) =>
    (await anonymousClient().getBuilder({ nearAccount })).data.name;

  async function created() {
    const nearAccount = nextAccount();
    await clientFor(agencyAdmin).createBuilder({ nearAccount, name: "Ada" });
    return nearAccount;
  }

  test("any signed-in Agency admin can create a profile that does not exist yet", async () => {
    const nearAccount = await created();

    expect(await nameOf(nearAccount)).toBe("Ada");
  });

  test.each([
    [
      "anonymous callers cannot create profiles",
      "UNAUTHORIZED",
      () => anonymousClient().createBuilder({ nearAccount: nextAccount(), name: "Nobody" }),
    ],
    [
      "a profile cannot be linked to someone else's user",
      "FORBIDDEN",
      () => clientFor(agencyAdmin).createBuilder({ nearAccount: nextAccount(), userId: "victim" }),
    ],
  ])("%s", async (_name, code, call) => {
    await expect(call()).rejects.toMatchObject({ code });
  });

  test.each([
    ["another Agency creates it again", otherAgencyAdmin, "createBuilder"],
    ["another Agency edits it", otherAgencyAdmin, "updateBuilderProfile"],
    ["the Agency that created it edits it", agencyAdmin, "updateBuilderProfile"],
  ] as const)("an existing profile is kept when %s", async (_name, caller, method) => {
    const nearAccount = await created();

    await expect(clientFor(caller)[method]({ nearAccount, name: "Renamed" })).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    expect(await nameOf(nearAccount)).toBe("Ada");
  });

  test.each([
    ["the builder", (nearAccount: string): Caller => ({ userId: "ada", near: nearAccount })],
    ["a platform admin", (): Caller => platformAdmin],
  ])("%s can edit an existing profile", async (_name, caller) => {
    const nearAccount = await created();

    const updated = await clientFor(caller(nearAccount)).updateBuilderProfile({
      nearAccount,
      name: "Ada Lovelace",
    });

    expect(updated.data.name).toBe("Ada Lovelace");
  });

  test("the builder can fill in a profile an Agency created for them", async () => {
    const nearAccount = await created();

    const own = await clientFor({ userId: "ada", near: nearAccount }).createBuilder({
      nearAccount,
      bio: "Mathematician",
    });

    expect(own.data).toMatchObject({ name: "Ada", bio: "Mathematician" });
  });
});
