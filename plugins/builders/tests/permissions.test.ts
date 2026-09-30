import { createPluginRuntime } from "every-plugin";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import Plugin from "../src/index";

const PLUGIN_ID = "@everything-dev/builders-plugin";

type Caller = { userId: string; near?: string; linked?: string[]; platformAdmin?: boolean };

function contextOf(caller: Caller) {
  return {
    userId: caller.userId,
    user: { id: caller.userId, role: caller.platformAdmin ? "admin" : "user" },
    near: {
      primaryAccountId: caller.near ?? null,
      linkedAccounts: (caller.linked ?? []).map((accountId) => ({ accountId })),
    },
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
  // How the API calls the plugin for an Agency manager: in-process, trusted.
  let apiClientFor: (caller: Caller) => any;
  let anonymousClient: () => any;

  beforeAll(async () => {
    runtime = createPluginRuntime({ registry: { [PLUGIN_ID]: { module: Plugin } } } as any);
    const plugin = await (runtime as any).usePlugin(PLUGIN_ID, {
      variables: {},
      secrets: { BUILDERS_DATABASE_URL: ":memory:" },
    });
    clientFor = (caller) => plugin.createClient(contextOf(caller));
    apiClientFor = (caller) => plugin.createClient({ ...contextOf(caller), trusted: true });
    anonymousClient = () => plugin.createClient({});
  });

  afterAll(async () => {
    await runtime.shutdown();
  });

  const nameOf = async (nearAccount: string) =>
    (await anonymousClient().getBuilder({ nearAccount })).data.name;

  async function created() {
    const nearAccount = nextAccount();
    await apiClientFor(agencyAdmin).createBuilder({ nearAccount, name: "Ada" });
    return nearAccount;
  }

  test("an Agency manager, through the API, can create a contributor's profile", async () => {
    const nearAccount = await created();

    expect(await nameOf(nearAccount)).toBe("Ada");
  });

  test.each([
    ["signed in with it", (nearAccount: string): Caller => ({ userId: "ada", near: nearAccount })],
    [
      "with it linked",
      (nearAccount: string): Caller => ({ userId: "ada", near: "ada.near", linked: [nearAccount] }),
    ],
    ["as a platform admin", (): Caller => platformAdmin],
  ])("a profile can be created %s", async (_name, caller) => {
    const nearAccount = nextAccount();

    await clientFor(caller(nearAccount)).createBuilder({ nearAccount, name: "Ada" });

    expect(await nameOf(nearAccount)).toBe("Ada");
  });

  test.each([
    [
      "anonymous callers cannot create profiles",
      "UNAUTHORIZED",
      () => anonymousClient().createBuilder({ nearAccount: nextAccount(), name: "Nobody" }),
    ],
    [
      "a signed-in user cannot create a profile for an account that is not theirs",
      "FORBIDDEN",
      () => clientFor(agencyAdmin).createBuilder({ nearAccount: nextAccount(), name: "Squatter" }),
    ],
    [
      "a profile cannot be linked to someone else's user",
      "FORBIDDEN",
      () =>
        apiClientFor(agencyAdmin).createBuilder({ nearAccount: nextAccount(), userId: "victim" }),
    ],
  ])("%s", async (_name, code, call) => {
    await expect(call()).rejects.toMatchObject({ code });
  });

  test.each([
    ["another Agency creates it again", () => clientFor(otherAgencyAdmin), "createBuilder"],
    [
      "another Agency creates it again through the API",
      () => apiClientFor(otherAgencyAdmin),
      "createBuilder",
    ],
    ["another Agency edits it", () => clientFor(otherAgencyAdmin), "updateBuilderProfile"],
    ["the Agency that created it edits it", () => clientFor(agencyAdmin), "updateBuilderProfile"],
  ] as const)("an existing profile is kept when %s", async (_name, client, method) => {
    const nearAccount = await created();

    await expect(client()[method]({ nearAccount, name: "Renamed" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await nameOf(nearAccount)).toBe("Ada");
  });

  test.each([
    ["the builder", (nearAccount: string): Caller => ({ userId: "ada", near: nearAccount })],
    [
      "the builder, through a linked account",
      (nearAccount: string): Caller => ({ userId: "ada", near: "ada.near", linked: [nearAccount] }),
    ],
    ["a platform admin", (): Caller => platformAdmin],
  ])("%s can edit an existing profile", async (_name, caller) => {
    const nearAccount = await created();

    const updated = await clientFor(caller(nearAccount)).updateBuilderProfile({
      nearAccount,
      name: "Ada Lovelace",
    });

    expect(updated.data.name).toBe("Ada Lovelace");
  });

  describe("claiming", () => {
    const userIdOf = async (nearAccount: string) =>
      (await anonymousClient().getBuilder({ nearAccount })).data.userId;
    const ada = (nearAccount: string): Caller => ({ userId: "ada", near: nearAccount });
    const adaLinked = (nearAccount: string): Caller => ({
      userId: "ada",
      near: "ada.near",
      linked: [nearAccount],
    });

    test("a profile an Agency creates is unclaimed", async () => {
      expect(await userIdOf(await created())).toBeNull();
    });

    test("a profile its owner creates is claimed by them", async () => {
      const nearAccount = nextAccount();

      await clientFor(adaLinked(nearAccount)).createBuilder({ nearAccount, name: "Ada" });

      expect(await userIdOf(nearAccount)).toBe("ada");
    });

    test.each([
      ["save it", ada, "updateBuilderProfile"],
      ["save it through a linked account", adaLinked, "updateBuilderProfile"],
      ["fill it in", ada, "createBuilder"],
    ] as const)("the owner claims an Agency's profile when they %s", async (_name, owner, method) => {
      const nearAccount = await created();

      await clientFor(owner(nearAccount))[method]({ nearAccount, bio: "Mathematician" });

      expect(await userIdOf(nearAccount)).toBe("ada");
    });

    test("a platform admin's edit does not claim it", async () => {
      const nearAccount = await created();

      await clientFor(platformAdmin).updateBuilderProfile({ nearAccount, bio: "Edited" });

      expect(await userIdOf(nearAccount)).toBeNull();
    });
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
