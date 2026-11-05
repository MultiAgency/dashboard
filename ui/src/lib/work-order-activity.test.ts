import { describe, expect, test } from "vitest";
import type { WorkOrderDetail } from "@/components/work-orders/work-order-status";
import { activityTimeline } from "./work-order-activity";

const workOrder = {
  id: "wo1",
  status: "active",
  tokenId: "usd",
  builder: { name: "Carol", nearAccount: "carol.near" },
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-25T10:00:00.000Z",
  offeredAt: "2026-09-02T10:00:00.000Z",
  acceptedAt: "2026-09-03T10:00:00.000Z",
  activatedAt: "2026-09-04T10:00:00.000Z",
  periodStart: "2026-09-04",
  periodEnd: "2026-09-30",
  signing: {
    builder: { name: "Carol", signedAt: "2026-09-03T10:00:00.000Z" },
    representative: { name: "Rita", signedAt: "2026-09-02T11:00:00.000Z" },
  },
  signature: {
    method: "documenso",
    signedAt: "2026-09-03T10:00:00.000Z",
    signers: [],
    driveUrl: "https://drive.google.com/file/d/signed",
  },
  requests: [
    {
      id: "r1",
      code: "WO-0001-R1",
      status: "rejected",
      requestedAmount: "500000000",
      approvedAmount: null,
      coversFrom: "2026-09-04",
      coversTo: "2026-09-15",
      submittedAt: "2026-09-16T10:00:00.000Z",
      decidedAt: "2026-09-17T10:00:00.000Z",
      paidAt: null,
      note: "Missing pull requests",
      updatedAt: "2026-09-17T10:00:00.000Z",
    },
  ],
  renewal: null,
} as unknown as WorkOrderDetail;

describe("activityTimeline", () => {
  test("lists what happened newest first, with the emails it sent", () => {
    const events = activityTimeline(workOrder, [
      {
        id: "e1",
        eventType: "work_order.offered",
        to: "carol@example.com",
        subject: "Sign WO-0001",
        createdAt: "2026-09-02T11:30:00.000Z",
        deliveredAt: "2026-09-02T11:31:00.000Z",
        lastError: null,
      },
      {
        id: "e2",
        eventType: "work_order.signed",
        to: "rita@example.com",
        subject: "Carol signed",
        createdAt: "2026-09-03T10:01:00.000Z",
        deliveredAt: null,
        lastError: "Resend is down",
      },
    ]);
    expect(events.map((e) => e.title)).toEqual([
      "WO-0001-R1 rejected",
      "WO-0001-R1 submitted",
      "Activated: the work period started",
      "Email: Carol signed → rita@example.com",
      "Signed by Carol",
      "Signed PDF saved",
      "Email: Sign WO-0001 → carol@example.com",
      "Signed by Rita",
      "Offered to Carol",
      "Created as a draft",
    ]);
    const failed = events.find((e) => e.key === "email-e2");
    expect(failed?.detail).toBe("failed: Resend is down");
    expect(failed?.tone).toBe("destructive");
    expect(events.find((e) => e.key === "email-e1")?.detail).toBe("delivered");
    expect(events.find((e) => e.key === "r1-decided")?.detail).toBe("Missing pull requests");
    expect(events.some((e) => e.key === "accepted")).toBe(false);
  });
});
