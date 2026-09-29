import { beforeEach, describe, expect, test } from "vitest";
import { createNotifications } from "../../src/services/notifications";
import type { EmailMessage } from "../../src/services/notify";
import { inMemoryOrganizations } from "../fakes/organizations";
import { migratedDatabase } from "./_pg";

describe("notifications", () => {
  const database = migratedDatabase({ perTest: true });
  let sent: EmailMessage[];

  const directory = inMemoryOrganizations({
    organizations: [{ id: "acme", name: "Acme" }],
    members: [
      { userId: "owner", organizationId: "acme", role: "owner" },
      { userId: "admin", organizationId: "acme", role: "admin" },
      { userId: "wallet-admin", organizationId: "acme", role: "admin" },
      { userId: "viewer", organizationId: "acme", role: "member" },
    ],
    users: [
      { id: "owner", email: "owner@acme.example" },
      { id: "admin", email: "admin@acme.example" },
      { id: "wallet-admin", email: "wallet.near@near.email" },
      { id: "viewer", email: "viewer@acme.example" },
    ],
  }).directory;

  beforeEach(() => {
    sent = [];
  });

  function service(sendEmail = async (m: EmailMessage) => void sent.push(m)) {
    return createNotifications({
      db: database.db,
      directory,
      sendEmail,
      appOrigin: "https://app.example",
    });
  }

  const proposal = {
    organizationId: "acme",
    kind: "engagement_proposed" as const,
    payload: { agencyName: "Studio", clientName: "Acme", engagementId: "e1" },
    link: "/client",
  };

  test("the acting user is not notified of their own action", async () => {
    await service().notify({ ...proposal, excludeUserId: "owner" });

    expect((await service().unreadCount("owner")).count).toBe(0);
    expect((await service().unreadCount("admin")).count).toBe(1);
  });

  test("a failing email does not stop the inbox", async () => {
    const failing = service(async () => {
      throw new Error("resend down");
    });

    await expect(failing.notify(proposal)).resolves.toEqual({ recipients: 3, emailed: 0 });
    expect((await failing.unreadCount("owner")).count).toBe(1);
  });

  test("marking read clears the unread badge for that user only", async () => {
    await service().notify(proposal);
    await service().notify({ ...proposal, kind: "project_shared" });
    const [latest] = (await service().list("owner", { limit: 10 })).data;

    await service().markRead("owner", { ids: [latest!.id] });
    expect((await service().unreadCount("owner")).count).toBe(1);
    await service().markRead("admin", { ids: [latest!.id] });
    expect((await service().unreadCount("owner")).count).toBe(1);

    await service().markRead("owner", {});
    expect((await service().unreadCount("owner")).count).toBe(0);
    expect((await service().unreadCount("admin")).count).toBe(2);
  });

  test("the inbox pages newest first", async () => {
    for (let i = 0; i < 3; i++) await service().notify(proposal);

    const first = await service().list("owner", { limit: 2 });
    const second = await service().list("owner", { limit: 2, cursor: first.nextCursor! });

    expect(first.data).toHaveLength(2);
    expect(second.data).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });
});
