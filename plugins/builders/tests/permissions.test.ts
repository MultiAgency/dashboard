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

  test("any signed-in Agency admin can create a profile that does not exist yet", async () => {
    const nearAccount = nextAccount();

    const created = await clientFor(agencyAdmin).createBuilder({ nearAccount, name: "Ada" });

    expect(created.data).toMatchObject({ nearAccount, name: "Ada" });
    expect((await anonymousClient().getBuilder({ nearAccount })).data.name).toBe("Ada");
  });

  test("anonymous callers cannot create profiles", async () => {
    await expect(
      anonymousClient().createBuilder({ nearAccount: nextAccount(), name: "Nobody" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("creating a profile that exists does not overwrite it", async () => {
    const nearAccount = nextAccount();
    await clientFor(agencyAdmin).createBuilder({ nearAccount, name: "Ada" });

    await expect(
      clientFor(otherAgencyAdmin).createBuilder({ nearAccount, name: "Hijacked" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await anonymousClient().getBuilder({ nearAccount })).data.name).toBe("Ada");
  });

  test("another Agency cannot edit an existing profile, even the one that created it", async () => {
    const nearAccount = nextAccount();
    await clientFor(agencyAdmin).createBuilder({ nearAccount, name: "Ada" });

    for (const caller of [agencyAdmin, otherAgencyAdmin]) {
      await expect(
        clientFor(caller).updateBuilderProfile({ nearAccount, name: "Renamed" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await anonymousClient().getBuilder({ nearAccount })).data.name).toBe("Ada");
  });

  test("the builder can edit their own profile", async () => {
    const nearAccount = nextAccount();
    await clientFor(agencyAdmin).createBuilder({ nearAccount, name: "Ada" });

    const updated = await clientFor({ userId: "ada", near: nearAccount }).updateBuilderProfile({
      nearAccount,
      name: "Ada Lovelace",
    });

    expect(updated.data.name).toBe("Ada Lovelace");
  });

  test("the builder can fill in a profile an Agency created for them", async () => {
    const nearAccount = nextAccount();
    await clientFor(agencyAdmin).createBuilder({ nearAccount, name: "Ada" });

    const own = await clientFor({ userId: "ada", near: nearAccount }).createBuilder({
      nearAccount,
      bio: "Mathematician",
    });

    expect(own.data).toMatchObject({ name: "Ada", bio: "Mathematician" });
  });

  test("platform admins can edit any profile", async () => {
    const nearAccount = nextAccount();
    await clientFor(agencyAdmin).createBuilder({ nearAccount, name: "Ada" });

    const updated = await clientFor(platformAdmin).updateBuilderProfile({
      nearAccount,
      name: "Moderated",
    });

    expect(updated.data.name).toBe("Moderated");
  });

  test("a profile cannot be linked to someone else's user", async () => {
    await expect(
      clientFor(agencyAdmin).createBuilder({ nearAccount: nextAccount(), userId: "victim" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
