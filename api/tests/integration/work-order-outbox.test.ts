import { beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import { workOrderOutbox } from "../../src/db/schema";
import type { EmailMessage } from "../../src/services/notify";
import { composeEmails } from "../../src/services/work-orders/emails";
import { testEvent, type WorkOrderEvent } from "../../src/services/work-orders/events";
import {
  createWorkOrderIntegrations,
  createWorkOrderOutbox,
} from "../../src/services/work-orders/outbox";
import { migratedDatabase } from "./_pg";

function event(type: WorkOrderEvent["type"], over: Partial<WorkOrderEvent> = {}): WorkOrderEvent {
  return {
    ...testEvent("studio"),
    type,
    agency: { id: "studio", name: "Studio" },
    workOrder: {
      id: "SI-004",
      title: "Contributor role",
      project: "Search",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      budget: "1000 USDC",
    },
    contractor: {
      name: "Carol",
      email: "carol@example.com",
      github: "carol-gh",
      nearAccount: "carol.near",
    },
    representative: { name: "Rita", email: "rita@example.com" },
    links: {
      contractor: "https://app.example/work-orders/1",
      review: "https://app.example/admin/work-orders/1",
      report: null,
      confirm: "https://app.example/work-orders/1",
      document: null,
    },
    ...over,
  };
}

describe("work order emails", () => {
  const database = migratedDatabase({ perTest: true });
  let db: Database;
  let clock: Date;
  let sent: EmailMessage[];
  let integrations: ReturnType<typeof createWorkOrderIntegrations>;
  let outbox: ReturnType<typeof createWorkOrderOutbox>;

  beforeEach(() => {
    db = database.db;
    clock = new Date("2026-09-20T12:00:00.000Z");
    sent = [];
    integrations = createWorkOrderIntegrations({ db, now: () => clock });
    outbox = createWorkOrderOutbox({
      db,
      sendEmail: async (message) => {
        sent.push(message);
      },
      now: () => clock,
    });
  });

  test("each event emails the right people with the accepted-paid wording", () => {
    expect(composeEmails(event("work_order.active")).map((m) => m.to)).toEqual([
      "carol@example.com",
      "rita@example.com",
    ]);
    const confirm = composeEmails(event("work_order.confirm_payee"));
    expect(confirm).toHaveLength(1);
    expect(confirm[0]?.to).toBe("carol@example.com");
    expect(confirm[0]?.text).toContain("carol.near");
    expect(confirm[0]?.text).toContain("https://app.example/work-orders/1");
    const mismatch = composeEmails(
      event("work_order.signature_mismatch", {
        mismatches: ["budget: draft 1000, signed PDF 1500"],
      }),
    );
    expect(mismatch[0]?.subject).toBe("Work Order SI-004: the signed PDF doesn't match the draft");
    expect(mismatch[0]?.text).toContain("- budget: draft 1000, signed PDF 1500");
    const noEmail = event("work_order.active");
    noEmail.contractor.email = null;
    expect(composeEmails(noEmail).map((m) => m.to)).toEqual(["rita@example.com"]);
  });

  test("emails go out once through Resend", async () => {
    const signed = event("work_order.signed");
    signed.links.document = "https://drive.example/signed?id=1&v=2";
    const ids = await outbox.enqueue("studio", "wo1", signed);
    expect(ids).toHaveLength(2);
    expect(await outbox.deliver()).toEqual({ delivered: 2, failed: 0 });
    expect(sent.map((m) => m.to)).toEqual(["carol@example.com", "rita@example.com"]);
    expect(sent[0]?.html).toContain('<a href="https://drive.example/signed?id=1&amp;v=2">');
    expect(sent[0]?.subject).toBe("Work Order SI-004 is signed");
    expect(await outbox.deliver()).toEqual({ delivered: 0, failed: 0 });
  });

  test("an n8n webhook saved earlier is ignored: emails still go through Resend", async () => {
    await integrations.save("studio", "rita", "https://n8n.example/webhook/wo");
    await outbox.enqueue("studio", "wo1", event("work_order.created"));
    const rows = await db.select().from(workOrderOutbox);
    expect(rows.map((r) => r.channel)).toEqual(["email"]);
    await outbox.deliver();
    expect(sent.map((m) => m.to)).toEqual(["rita@example.com"]);
  });

  test("a failed email is retried with backoff", async () => {
    let fail = true;
    outbox = createWorkOrderOutbox({
      db,
      sendEmail: async (message) => {
        if (fail) throw new Error("Resend answered 502");
        sent.push(message);
      },
      now: () => clock,
    });
    await outbox.enqueue("studio", "wo1", event("work_order.active"));
    expect((await outbox.deliver()).failed).toBe(2);
    const [row] = await db.select().from(workOrderOutbox);
    expect(row?.lastError).toBe("Resend answered 502");
    expect(row?.nextAttemptAt.getTime()).toBe(clock.getTime() + 60_000);
    fail = false;
    expect((await outbox.deliver()).delivered).toBe(0);
    clock = new Date(clock.getTime() + 61_000);
    expect((await outbox.deliver()).delivered).toBe(2);
  });

  test("an Agency's inbound token is its own, and rotating it replaces it", async () => {
    const first = await integrations.save("studio", "rita", null);
    await integrations.save("rival", "ruth", null);
    expect(await integrations.organizationOfToken(first.inboundToken ?? "")).toBe("studio");
    expect(await integrations.organizationOfToken("wo_not-a-real-token-at-all-000000")).toBeNull();
    expect(
      (await integrations.save("studio", "rita", "https://n8n.example/hook")).inboundToken,
    ).toBeNull();
    const rotated = await integrations.rotate("studio", "rita");
    expect(await integrations.organizationOfToken(first.inboundToken ?? "")).toBeNull();
    expect(await integrations.organizationOfToken(rotated.inboundToken ?? "")).toBe("studio");
    expect((await integrations.settings("studio"))?.n8nWebhookUrl).toBe("https://n8n.example/hook");
  });

  test("deliveries older than a day are given up", async () => {
    outbox = createWorkOrderOutbox({
      db,
      sendEmail: async () => {
        throw new Error("down");
      },
      now: () => clock,
    });
    await outbox.enqueue("studio", "wo1", event("work_order.created"));
    clock = new Date(clock.getTime() + 25 * 3_600_000);
    expect(await outbox.deliver()).toEqual({ delivered: 0, failed: 0 });
  });
});
