import { createPluginRuntime } from "every-plugin";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import Plugin from "../src/index";

const PLUGIN_ID = "@everything-dev/projects-plugin";

type OrganizationRole = "owner" | "admin" | "member";

type Caller = {
  userId: string;
  near?: string;
  platformAdmin?: boolean;
  organization?: { id: string; role: OrganizationRole; personal?: boolean };
};

function contextOf(caller: Caller) {
  const { userId, near, platformAdmin, organization } = caller;
  return {
    userId,
    user: { id: userId, role: platformAdmin ? "admin" : "user" },
    near: near ? { primaryAccountId: near } : undefined,
    organization: organization
      ? {
          activeOrganizationId: organization.id,
          organization: {
            id: organization.id,
            name: organization.id,
            slug: organization.id,
            metadata: organization.personal ? { isPersonal: true } : {},
          },
          member: { id: `${organization.id}:${userId}`, role: organization.role },
        }
      : null,
  };
}

const acmeOwner: Caller = { userId: "acme-owner", organization: { id: "acme", role: "owner" } };
const acmeAdmin: Caller = { userId: "acme-admin", organization: { id: "acme", role: "admin" } };
const acmeMember: Caller = {
  userId: "acme-member",
  near: "member.near",
  organization: { id: "acme", role: "member" },
};
const acmeOtherMember: Caller = {
  userId: "acme-other",
  organization: { id: "acme", role: "member" },
};
const rivalAdmin: Caller = { userId: "rival-admin", organization: { id: "rival", role: "admin" } };
const soloOwner: Caller = {
  userId: "solo",
  organization: { id: "solo-personal", role: "owner", personal: true },
};
const platformAdmin: Caller = {
  userId: "platform",
  platformAdmin: true,
  organization: { id: "platform-personal", role: "owner", personal: true },
};

let slugCounter = 0;
const nextSlug = () => `project-${++slugCounter}`;

describe("projects plugin permissions", () => {
  let runtime: ReturnType<typeof createPluginRuntime>;
  let clientFor: (caller: Caller) => any;
  let anonymousClient: () => any;

  beforeAll(async () => {
    runtime = createPluginRuntime({ registry: { [PLUGIN_ID]: { module: Plugin } } } as any);
    const plugin = await (runtime as any).usePlugin(PLUGIN_ID, {
      variables: {},
      secrets: { PROJECTS_DATABASE_URL: ":memory:" },
    });
    clientFor = (caller) => plugin.createClient(contextOf(caller));
    anonymousClient = () => plugin.createClient({});
  });

  afterAll(async () => {
    await runtime.shutdown();
  });

  const createAs = (caller: Caller, input: Record<string, unknown> = {}) =>
    clientFor(caller).createProject({
      kind: "project",
      title: "Project",
      slug: nextSlug(),
      repository: "https://github.com/example/repo",
      ...input,
    });

  type Target = { id: string };
  type Action = (target: Target) => Promise<unknown>;
  const create =
    (caller: Caller, input: Record<string, unknown> = {}): Action =>
    () =>
      createAs(caller, input);
  const update =
    (caller: Caller, patch: Record<string, unknown>): Action =>
    (t) =>
      clientFor(caller).updateProject({ id: t.id, ...patch });
  const remove =
    (caller: Caller): Action =>
    (t) =>
      clientFor(caller).deleteProject({ id: t.id });

  const personalOwnerOfAcme: Caller = {
    ...soloOwner,
    organization: { id: "acme", role: "owner", personal: true },
  };
  const rivalOwner: Caller = { ...rivalAdmin, organization: { id: "rival", role: "owner" } };
  const publish = { visibility: "public" };

  test.each<[string, Action, Record<string, unknown>]>([
    [
      "binds a new Project to the caller's active Organization",
      create(acmeMember),
      { organizationId: "acme", ownerId: "member.near" },
    ],
    [
      "never binds a Project to a personal Organization",
      create(soloOwner),
      { organizationId: null },
    ],
    [
      "lets platform admins choose the owner on create",
      create(platformAdmin, { ownerId: "x.near" }),
      { ownerId: "x.near" },
    ],
    ["lets admins publish on create", create(acmeAdmin, publish), publish],
    [
      "lets admins edit any of the Organization's Projects",
      update(acmeAdmin, { title: "New" }),
      { title: "New" },
    ],
    [
      "lets owners edit any of the Organization's Projects",
      update(acmeOwner, { title: "New" }),
      { title: "New" },
    ],
    [
      "lets members edit the Projects they created",
      update(acmeOtherMember, { title: "New" }),
      { title: "New" },
    ],
    ["lets owners make a Project public", update(acmeOwner, publish), publish],
    [
      "lets platform admins edit any Project",
      update(platformAdmin, { title: "New" }),
      { title: "New" },
    ],
    [
      "lets platform admins change the owner",
      update(platformAdmin, { ownerId: "x.near" }),
      { ownerId: "x.near" },
    ],
    ["lets platform admins delete any Project", remove(platformAdmin), { deleted: true }],
  ])("%s", async (_, action, expected) => {
    const target = await createAs(acmeOtherMember);

    expect(await action(target)).toMatchObject(expected);
  });

  test.each<[string, Action]>([
    ["create in another Organization", create(acmeAdmin, { organizationId: "rival" })],
    ["create in a personal Organization", create(soloOwner, { organizationId: "solo-personal" })],
    ["let a non-platform admin choose the owner", create(acmeAdmin, { ownerId: "x.near" })],
    ["let a plain member publish on create", create(acmeMember, publish)],
    ["let another Organization's admin edit", update(rivalAdmin, { title: "Taken" })],
    ["let another Organization's admin delete", remove(rivalAdmin)],
    ["let a member edit another member's Project", update(acmeMember, { title: "Theirs" })],
    ["let a member delete another member's Project", remove(acmeMember)],
    ["give a personal Organization's owner rights over its Projects", remove(personalOwnerOfAcme)],
    ["let a non-platform admin change the owner", update(acmeAdmin, { ownerId: "acme-admin" })],
    ["let a plain member make a Project public", update(acmeMember, publish)],
    ["let another Organization's owner make a Project public", update(rivalOwner, publish)],
  ])("refuses to %s", async (_, action) => {
    const target = await createAs(acmeOtherMember);

    await expect(action(target)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await clientFor(acmeOwner).getProject({ id: target.id })).data).toMatchObject({
      title: "Project",
      visibility: "private",
    });
  });

  test("reports a taken slug so callers can suggest another", async () => {
    const created = await createAs(acmeMember);

    await expect(createAs(rivalAdmin, { slug: created.slug })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { validationErrors: [{ field: "slug", code: "SLUG_TAKEN" }] },
    });
  });

  test("does not reveal a private Project through an existing id", async () => {
    const hidden = await createAs(acmeMember);

    await expect(createAs(rivalAdmin, { id: hidden.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  describe("visibility", () => {
    test("members of the owning Organization see its private Projects", async () => {
      const created = await createAs(acmeOtherMember);

      const detail = await clientFor(acmeMember).getProject({ id: created.id });
      const listed = await clientFor(acmeMember).listProjects({ organizationId: "acme" });

      expect(detail.data.id).toBe(created.id);
      expect(listed.data.map((p: { id: string }) => p.id)).toContain(created.id);
    });

    test("other Organizations and anonymous visitors do not", async () => {
      const created = await createAs(acmeOtherMember);

      await expect(clientFor(rivalAdmin).getProject({ id: created.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      const listed = await anonymousClient().listProjects({ organizationId: "acme" });
      expect(listed.data.map((p: { id: string }) => p.id)).not.toContain(created.id);
      const rivalListing = await clientFor(rivalAdmin).listProjects({ organizationId: "acme" });
      expect(rivalListing.data.map((p: { id: string }) => p.id)).not.toContain(created.id);
    });
  });
});
