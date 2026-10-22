import { createHmac } from "node:crypto";
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

describe("work order emails and n8n deliveries", () => {
  const database = migratedDatabase({ perTest: true });
  let db: Database;
  let clock: Date;
  let sent: EmailMessage[];
  let posts: { url: string; body: string; headers: Record<string, string> }[];
  let status: number;
  let integrations: ReturnType<typeof createWorkOrderIntegrations>;
  let outbox: ReturnType<typeof createWorkOrderOutbox>;

  beforeEach(() => {
    db = database.db;
    clock = new Date("2026-09-20T12:00:00.000Z");
    sent = [];
    posts = [];
    status = 200;
    integrations = createWorkOrderIntegrations({ db, now: () => clock });
    outbox = createWorkOrderOutbox({
      db,
      integrations,
      sendEmail: async (message) => {
        sent.push(message);
      },
      post: async (url, body, headers) => {
        posts.push({ url, body, headers });
        return { status };
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

  test("emails go out once; without n8n nothing else is queued", async () => {
    const signed = event("work_order.signed");
    signed.links.document = "https://drive.example/signed?id=1&v=2";
    const ids = await outbox.enqueue("studio", "wo1", signed);
    expect(ids).toHaveLength(2);
    expect(await outbox.deliver()).toEqual({ delivered: 2, failed: 0 });
    expect(sent.map((m) => m.to)).toEqual(["carol@example.com", "rita@example.com"]);
    expect(sent[0]?.html).toContain('<a href="https://drive.example/signed?id=1&amp;v=2">');
    expect(sent[0]?.subject).toBe("Work Order SI-004 is signed");
    expect(await outbox.deliver()).toEqual({ delivered: 0, failed: 0 });
    expect(posts).toHaveLength(0);
  });

  test("n8n gets the signed event; a failure is retried with backoff", async () => {
    const { inboundToken } = await integrations.save(
      "studio",
      "rita",
      "https://n8n.example/webhook/wo",
    );
    expect(inboundToken).toMatch(/^wo_/);
    const settings = await integrations.settings("studio");
    status = 502;
    await outbox.enqueue("studio", "wo1", event("work_order.created"));
    expect((await outbox.deliver()).failed).toBe(1);
    const [row] = (await db.select().from(workOrderOutbox)).filter((r) => r.channel === "n8n");
    expect(row?.lastError).toBe("n8n answered 502");
    expect(row?.nextAttemptAt.getTime()).toBe(clock.getTime() + 60_000);

    status = 200;
    expect((await outbox.deliver()).delivered).toBe(0);
    clock = new Date(clock.getTime() + 61_000);
    expect((await outbox.deliver()).delivered).toBe(1);
    const last = posts.at(-1);
    expect(last?.url).toBe("https://n8n.example/webhook/wo");
    expect(last?.headers["X-AP-Event"]).toBe("work_order.created");
    expect(last?.headers["X-AP-Signature"]).toBe(
      `sha256=${createHmac("sha256", settings?.webhookSecret ?? "")
        .update(last?.body ?? "")
        .digest("hex")}`,
    );
    expect(JSON.parse(last?.body ?? "{}").workOrder.id).toBe("SI-004");
  });

  test("with n8n connected the emails travel in the event and Gmail sends them, not MultiAgency", async () => {
    await integrations.save("studio", "rita", "https://n8n.example/webhook/wo");
    await outbox.enqueue("studio", "wo1", event("work_order.active"));
    const rows = await db.select().from(workOrderOutbox);
    expect(rows.map((r) => r.channel)).toEqual(["n8n"]);
    await outbox.deliver();
    expect(sent).toHaveLength(0);
    const body = JSON.parse(posts.at(-1)?.body ?? "{}") as WorkOrderEvent;
    expect(body.emails?.map((m) => m.to)).toEqual(["carol@example.com", "rita@example.com"]);
    expect(body.emails?.[0]?.subject).toBe("Work Order SI-004 is active");

    await outbox.enqueue("studio", "wo1", event("work_order.created"));
    const queued = (await db.select().from(workOrderOutbox)).find(
      (r) => r.eventType === "work_order.created",
    );
    expect((JSON.parse(queued?.payload ?? "{}") as WorkOrderEvent).emails).toEqual([]);
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
    await integrations.save("studio", "rita", "https://n8n.example/hook");
    status = 500;
    await outbox.enqueue("studio", "wo1", event("work_order.created"));
    clock = new Date(clock.getTime() + 25 * 3_600_000);
    expect(await outbox.deliver()).toEqual({ delivered: 0, failed: 0 });
  });
});
