import { beforeEach, describe, expect, test } from "vitest";
import { budgets } from "../../src/db/schema";
import type { OrganizationScope } from "../../src/services/organization-access";
import { engagementWorld, ORIGIN, SPOOFED_ORIGIN } from "../fakes/engagements";
import { migratedDatabase } from "./_pg";

const refused = (promise: Promise<unknown>, reason: string) =>
  expect(promise).rejects.toMatchObject(
    reason === "NOT_FOUND" ? { code: reason } : { data: { reason } },
  );

describe("engagements", () => {
  const database = migratedDatabase({ perTest: true });
  let world: Awaited<ReturnType<typeof engagementWorld>>;

  beforeEach(async () => {
    world = await engagementWorld(database.db);
  });

  const studio = () => world.manager("studio-admin", "studio");
  const acme = () => world.manager("acme-owner", "acme");
  const inbox = async (userId: string) =>
    (await world.notifications.list(userId, { limit: 50 })).data.map((n) => n.kind);
  const proposeTo = async (slug = "acme", name = "Acme Corp", scope?: OrganizationScope) =>
    world.engagements.propose(scope ?? (await studio()), { slug, name });
  const share = async (engagementId: string, projectId: string, scope?: OrganizationScope) =>
    world.engagements.share(scope ?? (await studio()), { engagementId, projectId });
  const unshare = async (engagementId: string, projectId: string) =>
    world.engagements.unshare(await studio(), { engagementId, projectId });

  describe("proposing to an existing Organization", () => {
    test("the Client accepts and both sides see the active Engagement", async () => {
      const proposed = await proposeTo("ACME", " acme corp ");

      expect(proposed).toMatchObject({
        status: "proposed",
        side: "agency",
        agency: { id: "studio", name: "Studio" },
        client: { id: "acme", name: "Acme Corp" },
      });
      expect((await world.engagements.list(await acme())).data).toEqual([
        expect.objectContaining({ id: proposed.id, status: "proposed", side: "client" }),
      ]);

      expect((await world.engagements.accept(await acme(), proposed.id)).status).toBe("active");
      expect((await world.engagements.get(await studio(), proposed.id)).status).toBe("active");
    });

    test("the other side's owners and admins are notified in the inbox, and by email with links to the configured origin", async () => {
      const proposed = await proposeTo();

      expect(await inbox("acme-owner")).toEqual(["engagement_proposed"]);
      expect(await inbox("acme-member")).toEqual([]);
      expect(world.emails).toEqual([
        expect.objectContaining({
          to: "owner@acme.example",
          subject: "Studio proposed an Engagement",
        }),
      ]);
      expect(world.emails[0]?.html).toContain(`href="${ORIGIN}/client"`);
      expect(world.emails[0]?.html).not.toContain(SPOOFED_ORIGIN);

      await world.engagements.accept(await acme(), proposed.id);

      expect(await inbox("studio-admin")).toEqual(["engagement_accepted"]);
      expect(await inbox("studio-owner")).toEqual(["engagement_accepted"]);
      expect(world.emails.map((e) => e.to)).toEqual(["owner@acme.example", "admin@studio.example"]);
    });

    test.each([
      ["a name that does not match", "acme", "Acme", "NOT_FOUND"],
      ["an unknown slug", "nobody", "Nobody", "NOT_FOUND"],
      ["a personal Organization", "alice", "Alice", "NOT_FOUND"],
      ["itself", "studio", "Studio", "SELF_ENGAGEMENT"],
    ])("proposing to %s is refused", async (_, slug, name, reason) => {
      await refused(proposeTo(slug, name), reason);
      expect((await world.engagements.list(await studio())).data).toEqual([]);
    });

    test("only one pending proposal and one active Engagement exist per Agency and Client", async () => {
      const first = await proposeTo();
      await refused(proposeTo(), "ENGAGEMENT_EXISTS");

      await world.engagements.accept(await acme(), first.id);

      await refused(proposeTo(), "ENGAGEMENT_EXISTS");
      expect((await proposeTo("studio", "Studio", await acme())).status).toBe("proposed");
    });

    test("a declined or ended Engagement can be proposed again", async () => {
      const first = await proposeTo();
      expect((await world.engagements.decline(await acme(), first.id)).status).toBe("declined");
      expect(await inbox("studio-admin")).toEqual(["engagement_declined"]);

      const second = await proposeTo();
      await world.engagements.accept(await acme(), second.id);
      await world.engagements.end(await studio(), second.id);

      expect((await proposeTo()).status).toBe("proposed");
    });

    test("only the Client decides a proposal, and only while it is proposed", async () => {
      const proposed = await proposeTo();

      await refused(world.engagements.accept(await studio(), proposed.id), "NOT_FOUND");
      await refused(
        world.engagements.accept(await world.manager("rival-admin", "rival"), proposed.id),
        "NOT_FOUND",
      );
      await world.engagements.decline(await acme(), proposed.id);
      await refused(world.engagements.accept(await acme(), proposed.id), "NOT_PROPOSED");
    });
  });

  describe("ending", () => {
    test("either side ends an active Engagement and the other side is told", async () => {
      const engagement = await world.activeEngagement("acme");

      const ended = await world.engagements.end(await acme(), engagement.id);

      expect(ended.status).toBe("ended");
      expect(ended.endedAt).toBeInstanceOf(Date);
      expect(world.ended).toEqual([engagement.id]);
      expect(await inbox("studio-admin")).toContain("engagement_ended");
      await refused(world.engagements.end(await studio(), engagement.id), "NOT_ACTIVE");
    });

    test("the Agency withdraws its own pending proposal by ending it", async () => {
      const proposed = await proposeTo();

      await refused(world.engagements.end(await acme(), proposed.id), "NOT_ACTIVE");
      expect((await world.engagements.end(await studio(), proposed.id)).status).toBe("ended");
    });
  });

  describe("sharing", () => {
    test("the Agency shares its own Projects through an active Engagement only", async () => {
      const proposed = await proposeTo();
      await refused(share(proposed.id, "p1"), "NOT_ACTIVE");

      await world.engagements.accept(await acme(), proposed.id);
      await refused(share(proposed.id, "r1"), "NOT_FOUND");
      await refused(share(proposed.id, "p1", await acme()), "NOT_FOUND");

      const shared = await share(proposed.id, "p1");
      await share(proposed.id, "p1");

      expect(shared.projectIds).toEqual(["p1"]);
      expect((await inbox("acme-owner")).filter((k) => k === "project_shared")).toHaveLength(1);
    });

    test("one Project is shared with several Clients", async () => {
      await world.activeEngagement("acme", ["p1"]);
      const withNewco = await world.engagements.createWithClient(await studio(), {
        name: "Newco",
        slug: "newco",
        adminEmail: "boss@newco.example",
        projectIds: ["p1"],
      });

      const listed = await world.engagements.list(await studio());

      expect(listed.data.map((e) => [e.client.name, e.projectIds]).sort()).toEqual([
        ["Acme Corp", ["p1"]],
        ["Newco", ["p1"]],
      ]);
      expect(withNewco.projectIds).toEqual(["p1"]);
    });

    test("unsharing is refused while the Project holds budget attributed to the Engagement", async () => {
      const engagement = await world.activeEngagement("acme", ["p1"]);
      const entry = (id: string, amount: string) => ({
        id,
        projectId: "p1",
        tokenId: "near",
        amount,
        actorAccountId: "admin.near",
        engagementId: engagement.id,
      });
      await database.db.insert(budgets).values(entry("attributed", "100"));

      await refused(unshare(engagement.id, "p1"), "ATTRIBUTED_BUDGET");

      await database.db.insert(budgets).values(entry("pulled-back", "-100"));
      expect((await unshare(engagement.id, "p1")).projectIds).toEqual([]);
      expect(await inbox("acme-owner")).toContain("project_unshared");
    });

    test("an ended Engagement keeps its shared Projects and takes no new sharing", async () => {
      const engagement = await world.activeEngagement("acme", ["p1"]);
      await world.engagements.end(await studio(), engagement.id);

      await refused(share(engagement.id, "p2"), "NOT_ACTIVE");
      await refused(unshare(engagement.id, "p1"), "NOT_ACTIVE");
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

    const invitationActions = [
      ["resend", (id: string) => studio().then((s) => world.engagements.resendInvitation(s, id))],
      ["cancel", (id: string) => studio().then((s) => world.engagements.cancelInvitation(s, id))],
      [
        "re-address",
        (id: string) =>
          studio().then((s) => world.engagements.changeInvitationEmail(s, id, "x@newco.example")),
      ],
    ] as const;

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
      expect(world.emails[0]?.html).toContain(`href="${ORIGIN}/accept-invitation/`);
      expect(world.emails[0]?.html).not.toContain(SPOOFED_ORIGIN);
      expect(await inbox("studio-owner")).toEqual(["client_invite_sent"]);
    });

    test("a taken slug is refused", async () => {
      await refused(
        world.engagements.createWithClient(await studio(), {
          name: "Another Acme",
          slug: "acme",
          adminEmail: "x@acme.example",
        }),
        "SLUG_TAKEN",
      );
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
      await refused(world.engagements.resendInvitation(await acme(), engagement.id), "NOT_FOUND");
    });

    test.each(
      invitationActions,
    )("the Agency cannot %s the invitation after the Engagement ends", async (_, action) => {
      const engagement = await createNewco();
      await world.engagements.end(await studio(), engagement.id);

      await refused(action(engagement.id), "NOT_ACTIVE");
      expect(world.emails).toHaveLength(1);
    });

    test("once the first admin accepts, the Agency is told and can no longer manage the invitation", async () => {
      const engagement = await createNewco();
      const invitationId = new URL(engagement.invitation!.link, ORIGIN).pathname.split("/").pop()!;
      world.organizations.acceptInvitation(invitationId, "newco-boss");

      const clientView = await world.engagements.list(
        await world.manager("newco-boss", engagement.client.id),
      );
      expect(clientView.data.map((e) => [e.agency.name, e.status, e.invitation])).toEqual([
        ["Studio", "active", null],
      ]);
      expect((await world.engagements.get(await studio(), engagement.id)).invitation?.status).toBe(
        "accepted",
      );
      expect(await inbox("studio-owner")).toEqual(["client_invite_accepted", "client_invite_sent"]);
      expect(world.organizations.roleOf("newco-boss", engagement.client.id)).toBe("owner");
      for (const [, action] of invitationActions) {
        await refused(action(engagement.id), "INVITATION_ACCEPTED");
      }
    });
  });
});
