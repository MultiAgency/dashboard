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

  describe("create", () => {
    test("binds the Project to the caller's active Organization", async () => {
      const created = await createAs(acmeMember);

      expect(created).toMatchObject({ organizationId: "acme", ownerId: "member.near" });
    });

    test("refuses an Organization other than the caller's active one", async () => {
      await expect(createAs(acmeAdmin, { organizationId: "rival" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    test("never binds a Project to a personal Organization", async () => {
      expect((await createAs(soloOwner)).organizationId).toBeNull();
      await expect(createAs(soloOwner, { organizationId: "solo-personal" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    test("lets only platform admins choose the owner", async () => {
      await expect(createAs(acmeAdmin, { ownerId: "someone.near" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect((await createAs(platformAdmin, { ownerId: "someone.near" })).ownerId).toBe(
        "someone.near",
      );
    });

    test("publishing on create needs owner or admin of the Organization", async () => {
      await expect(createAs(acmeMember, { visibility: "public" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect((await createAs(acmeAdmin, { visibility: "public" })).visibility).toBe("public");
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
  });

  describe("edit and delete", () => {
    test("owners and admins of the owning Organization can edit any of its Projects", async () => {
      const created = await createAs(acmeMember);

      const updated = await clientFor(acmeAdmin).updateProject({ id: created.id, title: "New" });
      const byOwner = await clientFor(acmeOwner).updateProject({ id: created.id, title: "Newer" });

      expect(updated.title).toBe("New");
      expect(byOwner.title).toBe("Newer");
    });

    test("admins of another Organization cannot edit or delete", async () => {
      const created = await createAs(acmeMember);
      const rival = clientFor(rivalAdmin);

      await expect(rival.updateProject({ id: created.id, title: "Taken" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(rival.deleteProject({ id: created.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect((await clientFor(acmeMember).getProject({ id: created.id })).data.title).toBe(
        "Project",
      );
    });

    test("plain members can edit only the Projects they created", async () => {
      const own = await createAs(acmeMember);
      const others = await createAs(acmeOtherMember);
      const member = clientFor(acmeMember);

      expect((await member.updateProject({ id: own.id, title: "Mine" })).title).toBe("Mine");
      await expect(member.updateProject({ id: others.id, title: "Theirs" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(member.deleteProject({ id: others.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    test("a personal Organization's owner gains no rights over Organization Projects", async () => {
      const created = await createAs(acmeMember);

      await expect(
        clientFor({
          ...soloOwner,
          organization: { id: "acme", role: "owner", personal: true },
        }).deleteProject({ id: created.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    test("platform admins can edit and delete any Project", async () => {
      const created = await createAs(acmeMember);
      const admin = clientFor(platformAdmin);

      expect((await admin.updateProject({ id: created.id, title: "Moderated" })).title).toBe(
        "Moderated",
      );
      expect(await admin.deleteProject({ id: created.id })).toEqual({ deleted: true });
    });

    test("only platform admins can change the owner", async () => {
      const created = await createAs(acmeMember);

      await expect(
        clientFor(acmeAdmin).updateProject({ id: created.id, ownerId: "acme-admin" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        (await clientFor(platformAdmin).updateProject({ id: created.id, ownerId: "new.near" }))
          .ownerId,
      ).toBe("new.near");
    });

    test("making a Project public needs owner or admin of the owning Organization", async () => {
      const created = await createAs(acmeMember);

      await expect(
        clientFor(acmeMember).updateProject({ id: created.id, visibility: "public" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        clientFor({ ...rivalAdmin, organization: { id: "rival", role: "owner" } }).updateProject({
          id: created.id,
          visibility: "public",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        (await clientFor(acmeOwner).updateProject({ id: created.id, visibility: "public" }))
          .visibility,
      ).toBe("public");
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
