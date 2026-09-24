import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { createNotifications } from "../../src/services/notifications";
import type { EmailMessage } from "../../src/services/notify";
import { inMemoryOrganizations } from "../fakes/organizations";
import { applyAllMigrations } from "./_pg";

describe("notifications", () => {
  let pg: PGlite;
  let db: Database;
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

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
    sent = [];
  });

  afterEach(async () => {
    await pg.close();
  });

  function service(sendEmail = async (m: EmailMessage) => void sent.push(m)) {
    return createNotifications({ db, directory, sendEmail, appOrigin: "https://app.example" });
  }

  const proposal = {
    organizationId: "acme",
    kind: "engagement_proposed" as const,
    payload: { agencyName: "Studio", clientName: "Acme", engagementId: "e1" },
    link: "/client",
  };

  test("owners and admins of the asked Organization get an inbox item; those with an email also get one", async () => {
    const result = await service().notify(proposal);

    expect(result).toEqual({ recipients: 3, emailed: 2 });
    expect(sent.map((m) => m.to).sort()).toEqual(["admin@acme.example", "owner@acme.example"]);
    expect(sent[0]?.html).toContain('href="https://app.example/client"');
    const inbox = await service().list("wallet-admin", { limit: 10 });
    expect(inbox.data).toEqual([
      expect.objectContaining({
        kind: "engagement_proposed",
        title: "Studio proposed an Engagement",
        link: "/client",
        readAt: null,
      }),
    ]);
    expect((await service().list("viewer", { limit: 10 })).data).toEqual([]);
  });

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
