import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { budgets } from "../../src/db/schema";
import { engagementWorld, ORIGIN } from "../fakes/engagements";
import { project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const organizations = [
  { id: "studio", name: "Studio", slug: "studio", daoAccountId: "studio.sputnik-dao.near" },
  { id: "rival", name: "Rival", slug: "rival" },
  { id: "acme", name: "Acme Corp", slug: "acme" },
  { id: "alice-personal", name: "Alice", slug: "alice", isPersonal: true },
];

const members = [
  { userId: "studio-admin", organizationId: "studio", role: "admin" as const },
  { userId: "studio-owner", organizationId: "studio", role: "owner" as const },
  { userId: "rival-admin", organizationId: "rival", role: "owner" as const },
  { userId: "acme-owner", organizationId: "acme", role: "owner" as const },
  { userId: "acme-member", organizationId: "acme", role: "member" as const },
  { userId: "alice", organizationId: "alice-personal", role: "owner" as const },
];

const users = [
  { id: "studio-admin", email: "admin@studio.example" },
  { id: "studio-owner", email: "studio-owner.near@near.email" },
  { id: "rival-admin", email: "rival@rival.example" },
  { id: "acme-owner", email: "owner@acme.example" },
  { id: "acme-member", email: "member@acme.example" },
  { id: "alice", email: "alice@example.com" },
  { id: "newco-boss", email: "boss@newco.example" },
];

const projects = [project("p1", "studio"), project("p2", "studio"), project("r1", "rival")];

describe("engagements", () => {
  let pg: PGlite;
  let db: Database;
  let world: Awaited<ReturnType<typeof engagementWorld>>;

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
    world = await engagementWorld(db, { organizations, members, users, projects });
  });

  afterEach(async () => {
    await pg.close();
  });

  const studio = () => world.manager("studio-admin", "studio");
  const acme = () => world.manager("acme-owner", "acme");
  const inbox = async (userId: string) =>
    (await world.notifications.list(userId, { limit: 50 })).data.map((n) => n.kind);

  async function activeWithAcme() {
    const proposed = await world.engagements.propose(await studio(), {
      slug: "acme",
      name: "Acme Corp",
    });
    return world.engagements.accept(await acme(), proposed.id);
  }

  describe("proposing to an existing Organization", () => {
    test("the Client accepts and both sides see the active Engagement", async () => {
      const proposed = await world.engagements.propose(await studio(), {
        slug: "ACME",
        name: " acme corp ",
      });

      expect(proposed).toMatchObject({
        status: "proposed",
        side: "agency",
        agency: { id: "studio", name: "Studio" },
        client: { id: "acme", name: "Acme Corp" },
      });
      const clientView = await world.engagements.list(await acme());
      expect(clientView.data).toEqual([
        expect.objectContaining({ id: proposed.id, status: "proposed", side: "client" }),
      ]);

      const accepted = await world.engagements.accept(await acme(), proposed.id);

      expect(accepted.status).toBe("active");
      expect((await world.engagements.get(await studio(), proposed.id)).status).toBe("active");
    });

    test("the asked Organization's owners and admins are notified in the inbox and by email", async () => {
      const proposed = await world.engagements.propose(await studio(), {
        slug: "acme",
        name: "Acme Corp",
      });

      expect(await inbox("acme-owner")).toEqual(["engagement_proposed"]);
      expect(await inbox("acme-member")).toEqual([]);
      expect(world.emails).toEqual([
        expect.objectContaining({
          to: "owner@acme.example",
          subject: "Studio proposed an Engagement",
        }),
      ]);
      expect(world.emails[0]?.html).toContain(`${ORIGIN}/client`);

      await world.engagements.accept(await acme(), proposed.id);

      expect(await inbox("studio-admin")).toEqual(["engagement_accepted"]);
      expect(await inbox("studio-owner")).toEqual(["engagement_accepted"]);
      expect(world.emails.map((e) => e.to)).toEqual(["owner@acme.example", "admin@studio.example"]);
    });

    test("an Organization is found only by its slug and confirmed by its exact name", async () => {
      const scope = await studio();

      await expect(
        world.engagements.propose(scope, { slug: "acme", name: "Acme" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        world.engagements.propose(scope, { slug: "nobody", name: "Nobody" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        world.engagements.propose(scope, { slug: "alice", name: "Alice" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        world.engagements.propose(scope, { slug: "studio", name: "Studio" }),
      ).rejects.toMatchObject({ data: { reason: "SELF_ENGAGEMENT" } });
      expect((await world.engagements.list(scope)).data).toEqual([]);
    });

    test("only one pending proposal and one active Engagement exist per Agency and Client", async () => {
      const scope = await studio();
      const first = await world.engagements.propose(scope, { slug: "acme", name: "Acme Corp" });

      await expect(
        world.engagements.propose(scope, { slug: "acme", name: "Acme Corp" }),
      ).rejects.toMatchObject({ data: { reason: "ENGAGEMENT_EXISTS" } });

      await world.engagements.accept(await acme(), first.id);

      await expect(
        world.engagements.propose(scope, { slug: "acme", name: "Acme Corp" }),
      ).rejects.toMatchObject({ data: { reason: "ENGAGEMENT_EXISTS" } });
      const reverse = await world.engagements.propose(await acme(), {
        slug: "studio",
        name: "Studio",
      });
      expect(reverse.status).toBe("proposed");
    });

    test("a declined or ended Engagement can be proposed again", async () => {
      const scope = await studio();
      const first = await world.engagements.propose(scope, { slug: "acme", name: "Acme Corp" });

      const declined = await world.engagements.decline(await acme(), first.id);
      expect(declined.status).toBe("declined");
      expect(await inbox("studio-admin")).toEqual(["engagement_declined"]);

      const second = await world.engagements.propose(scope, { slug: "acme", name: "Acme Corp" });
      await world.engagements.accept(await acme(), second.id);
      await world.engagements.end(scope, second.id);

      const third = await world.engagements.propose(scope, { slug: "acme", name: "Acme Corp" });
      expect(third.status).toBe("proposed");
    });

    test("only the Client decides a proposal, and only while it is proposed", async () => {
      const proposed = await world.engagements.propose(await studio(), {
        slug: "acme",
        name: "Acme Corp",
      });

      await expect(world.engagements.accept(await studio(), proposed.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        world.engagements.accept(await world.manager("rival-admin", "rival"), proposed.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      await world.engagements.decline(await acme(), proposed.id);

      await expect(world.engagements.accept(await acme(), proposed.id)).rejects.toMatchObject({
        data: { reason: "NOT_PROPOSED" },
      });
    });
  });

  describe("ending", () => {
    test("either side ends an active Engagement and the other side is told", async () => {
      const engagement = await activeWithAcme();

      const ended = await world.engagements.end(await acme(), engagement.id);

      expect(ended.status).toBe("ended");
      expect(ended.endedAt).toBeInstanceOf(Date);
      expect(world.ended).toEqual([engagement.id]);
      expect(await inbox("studio-admin")).toContain("engagement_ended");
      await expect(world.engagements.end(await studio(), engagement.id)).rejects.toMatchObject({
        data: { reason: "NOT_ACTIVE" },
      });
    });

    test("the Agency withdraws its own pending proposal by ending it", async () => {
      const proposed = await world.engagements.propose(await studio(), {
        slug: "acme",
        name: "Acme Corp",
      });

      await expect(world.engagements.end(await acme(), proposed.id)).rejects.toMatchObject({
        data: { reason: "NOT_ACTIVE" },
      });
      const withdrawn = await world.engagements.end(await studio(), proposed.id);

      expect(withdrawn.status).toBe("ended");
    });
  });

  describe("sharing", () => {
    test("the Agency shares its own Projects through an active Engagement only", async () => {
      const proposed = await world.engagements.propose(await studio(), {
        slug: "acme",
        name: "Acme Corp",
      });
      await expect(
        world.engagements.share(await studio(), { engagementId: proposed.id, projectId: "p1" }),
      ).rejects.toMatchObject({ data: { reason: "NOT_ACTIVE" } });

      await world.engagements.accept(await acme(), proposed.id);
      await expect(
        world.engagements.share(await studio(), { engagementId: proposed.id, projectId: "r1" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        world.engagements.share(await acme(), { engagementId: proposed.id, projectId: "p1" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      const shared = await world.engagements.share(await studio(), {
        engagementId: proposed.id,
        projectId: "p1",
      });
      await world.engagements.share(await studio(), {
        engagementId: proposed.id,
        projectId: "p1",
      });

      expect(shared.projectIds).toEqual(["p1"]);
      expect((await inbox("acme-owner")).filter((k) => k === "project_shared")).toHaveLength(1);
    });

    test("one Project is shared with several Clients", async () => {
      const withAcme = await activeWithAcme();
      const withNewco = await world.engagements.createWithClient(await studio(), {
        name: "Newco",
        slug: "newco",
        adminEmail: "boss@newco.example",
        projectIds: ["p1"],
      });
      await world.engagements.share(await studio(), {
        engagementId: withAcme.id,
        projectId: "p1",
      });

      const listed = await world.engagements.list(await studio());

      expect(
        listed.data
          .map((e) => [e.client.name, e.projectIds])
          .sort(([a], [b]) => (a! < b! ? -1 : 1)),
      ).toEqual([
        ["Acme Corp", ["p1"]],
        ["Newco", ["p1"]],
      ]);
      expect(withNewco.projectIds).toEqual(["p1"]);
    });

    test("unsharing is refused while the Project holds budget attributed to the Engagement", async () => {
      const engagement = await activeWithAcme();
      await world.engagements.share(await studio(), {
        engagementId: engagement.id,
        projectId: "p1",
      });
      await db.insert(budgets).values({
        id: "attributed",
        projectId: "p1",
        tokenId: "near",
        amount: "100",
        actorAccountId: "admin.near",
        engagementId: engagement.id,
      });

      await expect(
        world.engagements.unshare(await studio(), { engagementId: engagement.id, projectId: "p1" }),
      ).rejects.toMatchObject({ data: { reason: "ATTRIBUTED_BUDGET" } });

      await db.insert(budgets).values({
        id: "pulled-back",
        projectId: "p1",
        tokenId: "near",
        amount: "-100",
        actorAccountId: "admin.near",
        engagementId: engagement.id,
      });
      const unshared = await world.engagements.unshare(await studio(), {
        engagementId: engagement.id,
        projectId: "p1",
      });

      expect(unshared.projectIds).toEqual([]);
      expect(await inbox("acme-owner")).toContain("project_unshared");
    });

    test("an ended Engagement keeps its shared Projects and takes no new sharing", async () => {
      const engagement = await activeWithAcme();
      await world.engagements.share(await studio(), {
        engagementId: engagement.id,
        projectId: "p1",
      });
      await world.engagements.end(await studio(), engagement.id);

      await expect(
        world.engagements.share(await studio(), { engagementId: engagement.id, projectId: "p2" }),
      ).rejects.toMatchObject({ data: { reason: "NOT_ACTIVE" } });
      await expect(
        world.engagements.unshare(await studio(), { engagementId: engagement.id, projectId: "p1" }),
      ).rejects.toMatchObject({ data: { reason: "NOT_ACTIVE" } });
      expect((await world.engagements.get(await acme(), engagement.id)).projectIds).toEqual(["p1"]);
    });
  });

  describe("creating a new Client", () => {
    async function createNewco() {
      return world.engagements.createWithClient(await studio(), {
        name: "Newco",
        slug: "newco",
        adminEmail: "Boss@Newco.example",
      });
    }

    test("creates the Client Organization without the Agency admin and invites its first admin as owner", async () => {
      const engagement = await createNewco();

      expect(engagement).toMatchObject({
        status: "active",
        client: { name: "Newco", slug: "newco" },
        invitation: { email: "boss@newco.example", status: "pending" },
      });
      expect(world.organizations.roleOf("studio-admin", engagement.client.id)).toBeNull();
      expect(world.emails).toEqual([
        expect.objectContaining({
          to: "boss@newco.example",
          subject: "Studio invited you to Newco on MultiAgency",
        }),
      ]);
      expect(world.emails[0]?.html).toContain(`${ORIGIN}/accept-invitation/`);
      expect(await inbox("studio-owner")).toEqual(["client_invite_sent"]);
    });

    test("a taken slug is refused", async () => {
      await expect(
        world.engagements.createWithClient(await studio(), {
          name: "Another Acme",
          slug: "acme",
          adminEmail: "x@acme.example",
        }),
      ).rejects.toMatchObject({ data: { reason: "SLUG_TAKEN" } });
    });

    test("the Agency resends, re-addresses and cancels the invitation until it is accepted", async () => {
      const engagement = await createNewco();

      await world.engagements.resendInvitation(await studio(), engagement.id);
      const readdressed = await world.engagements.changeInvitationEmail(
        await studio(),
        engagement.id,
        "ceo@newco.example",
      );
      expect(readdressed.invitation).toMatchObject({
        email: "ceo@newco.example",
        status: "pending",
      });
      expect(world.emails.map((e) => e.to)).toEqual([
        "boss@newco.example",
        "boss@newco.example",
        "ceo@newco.example",
      ]);

      const canceled = await world.engagements.cancelInvitation(await studio(), engagement.id);
      expect(canceled.invitation?.status).toBe("canceled");

      const resent = await world.engagements.resendInvitation(await studio(), engagement.id);
      expect(resent.invitation?.status).toBe("pending");
      await expect(
        world.engagements.resendInvitation(await acme(), engagement.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("once the first admin accepts, the Agency is told and can no longer manage the invitation", async () => {
      const engagement = await createNewco();
      const invitationId = new URL(engagement.invitation!.link, ORIGIN).pathname.split("/").pop()!;
      world.organizations.acceptInvitation(invitationId, "newco-boss");

      const view = await world.engagements.get(await studio(), engagement.id);

      expect(view.invitation?.status).toBe("accepted");
      expect(await inbox("studio-owner")).toEqual(["client_invite_accepted", "client_invite_sent"]);
      expect(world.organizations.roleOf("newco-boss", engagement.client.id)).toBe("owner");
      expect(world.organizations.roleOf("studio-admin", engagement.client.id)).toBeNull();
      for (const action of [
        () => world.engagements.resendInvitation,
        () => world.engagements.cancelInvitation,
      ]) {
        await expect(action()(await studio(), engagement.id)).rejects.toMatchObject({
          data: { reason: "INVITATION_ACCEPTED" },
        });
      }
      await expect(
        world.engagements.changeInvitationEmail(await studio(), engagement.id, "x@newco.example"),
      ).rejects.toMatchObject({ data: { reason: "INVITATION_ACCEPTED" } });
    });
  });
});
