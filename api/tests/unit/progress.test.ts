import { describe, expect, test } from "vitest";
import {
  type ProgressInput,
  type ProgressRequest,
  progressOf,
} from "../../src/services/work-orders/progress";

const base: ProgressInput = {
  status: "draft",
  builderName: "Carol",
  representativeName: "Rita Rep",
  createdAt: "2026-10-26T10:00:00.000Z",
  offeredAt: null,
  acceptedAt: null,
  activatedAt: null,
  updatedAt: "2026-10-26T10:00:00.000Z",
  periodStart: "2026-10-26",
  periodEnd: "2026-10-31",
  today: "2026-10-26",
  signFirst: true,
  builderSignedAt: null,
  representativeSignedAt: null,
  awaitingRepresentative: false,
  needsCountersign: false,
  representativeUrl: null,
  esignError: null,
  blockers: [],
  payeeNeedsConfirmation: false,
  documentWarning: null,
  driveError: null,
  renewalStatus: null,
  requests: [],
};

function request(over: Partial<ProgressRequest> = {}): ProgressRequest {
  return {
    id: "r1",
    code: "DM-007-R1",
    status: "draft",
    requested: "$1",
    approved: null,
    note: null,
    submittedAt: null,
    decidedAt: null,
    paidAt: null,
    blockedReason: null,
    blockedCode: null,
    createdAt: "2026-10-31T10:00:00.000Z",
    ...over,
  };
}

const signedActive: Partial<ProgressInput> = {
  status: "active",
  offeredAt: "2026-10-26T10:01:00.000Z",
  representativeSignedAt: "2026-10-26T10:02:00.000Z",
  builderSignedAt: "2026-10-26T10:05:00.000Z",
  acceptedAt: "2026-10-26T10:05:00.000Z",
  activatedAt: "2026-10-26T10:05:30.000Z",
};

const stateOf = (input: Partial<ProgressInput>) =>
  Object.fromEntries(progressOf({ ...base, ...input }).steps.map((s) => [s.key, s.state]));

describe("work order progress", () => {
  test("a draft waits on the agency to offer it", () => {
    const p = progressOf(base);
    expect(p).toMatchObject({ stage: "draft", waitingOn: "you", needsYou: true });
    expect(p.next).toEqual({ kind: "offer", label: "Offer and sign" });
    expect(p.steps.map((s) => s.label)).toEqual([
      "Draft",
      "You sign",
      "Builder signs",
      "Active",
      "Payout request",
      "Approved",
      "Paid",
      "Ended",
    ]);
    expect(p.steps[0]?.state).toBe("current");
  });

  test("after offering, the agency signs first through its Documenso link", () => {
    const p = progressOf({
      ...base,
      status: "offered",
      offeredAt: "2026-10-26T10:01:00.000Z",
      awaitingRepresentative: true,
      representativeUrl: "https://sign.example/rep",
    });
    expect(p).toMatchObject({
      stage: "agency_signs",
      waitingOn: "you",
      headline: "Sign it to send it to Carol",
    });
    expect(p.next).toEqual({
      kind: "link",
      label: "Sign as Rita Rep",
      href: "https://sign.example/rep",
      external: true,
    });
  });

  test("once the agency signed, it waits on the builder", () => {
    const p = progressOf({
      ...base,
      status: "offered",
      offeredAt: "2026-10-26T10:01:00.000Z",
      representativeSignedAt: "2026-10-26T10:02:00.000Z",
    });
    expect(p).toMatchObject({ stage: "builder_signs", waitingOn: "builder", needsYou: false });
    expect(p.since).toBe("2026-10-26T10:02:00.000Z");
    expect(
      stateOf({ status: "offered", representativeSignedAt: "x", offeredAt: "y" }),
    ).toMatchObject({
      draft: "done",
      agency_signs: "done",
      builder_signs: "current",
    });
  });

  test("without e-signature the builder accepts first and the agency countersigns", () => {
    const p = progressOf({
      ...base,
      signFirst: false,
      status: "accepted",
      needsCountersign: true,
      builderSignedAt: "2026-10-26T10:05:00.000Z",
      acceptedAt: "2026-10-26T10:05:00.000Z",
    });
    expect(p.steps.map((s) => s.key).slice(1, 3)).toEqual(["builder_signs", "agency_signs"]);
    expect(p).toMatchObject({
      stage: "agency_signs",
      waitingOn: "you",
      headline: "Carol signed: countersign to finish",
    });
  });

  test("a signed work order starts on its own, or names what blocks it", () => {
    const signed = {
      status: "accepted" as const,
      builderSignedAt: "a",
      representativeSignedAt: "b",
      acceptedAt: "2026-10-26T10:05:00.000Z",
    };
    expect(progressOf({ ...base, ...signed, periodStart: "2026-11-01" })).toMatchObject({
      waitingOn: "system",
      headline: "Signed. It starts automatically on 2026-11-01",
    });
    const blocked = progressOf({
      ...base,
      ...signed,
      blockers: ["Add the builder's GitHub login", "Add a repo"],
    });
    expect(blocked).toMatchObject({ waitingOn: "you", headline: "Add the builder's GitHub login" });
    expect(blocked.attention.map((a) => a.message)).toEqual(["Add a repo"]);
  });

  test("an active work order waits on the builder's work, then their request", () => {
    expect(progressOf({ ...base, ...signedActive })).toMatchObject({
      stage: "active",
      waitingOn: "builder",
      headline: "Work in progress until 2026-10-31. The payout request is drafted when it ends",
    });
    expect(progressOf({ ...base, ...signedActive, requests: [request()] })).toMatchObject({
      stage: "request",
      waitingOn: "builder",
    });
  });

  test("a submitted request asks the agency to approve it", () => {
    const p = progressOf({
      ...base,
      ...signedActive,
      requests: [request({ status: "submitted", submittedAt: "2026-10-31T11:00:00.000Z" })],
    });
    expect(p).toMatchObject({
      stage: "approved",
      waitingOn: "you",
      headline: "Approve $1 for Carol",
    });
    expect(p.next).toEqual({ kind: "approve", label: "Review and approve", requestId: "r1" });
    expect(Object.fromEntries(p.steps.map((s) => [s.key, s.state]))).toMatchObject({
      active: "done",
      request: "done",
      approved: "current",
      paid: "upcoming",
    });
  });

  test("an approved payout on hold points at funding the agent", () => {
    const p = progressOf({
      ...base,
      ...signedActive,
      requests: [
        request({
          status: "approved",
          approved: "$1",
          decidedAt: "2026-10-31T12:00:00.000Z",
          blockedReason: "Insufficient balance",
          blockedCode: "insufficient_balance",
        }),
      ],
    });
    expect(p).toMatchObject({
      stage: "paid",
      waitingOn: "you",
      headline: "Payout of $1 is on hold: fund the agent",
      next: {
        kind: "link",
        label: "Fund the agent",
        href: "/admin/settings#payouts",
        external: false,
      },
    });
    expect(p.steps.find((s) => s.key === "paid")?.state).toBe("blocked");
  });

  test("payouts in flight wait on the system or the DAO", () => {
    const approved = request({ status: "approved", approved: "$1", decidedAt: "d" });
    expect(progressOf({ ...base, ...signedActive, requests: [approved] }).waitingOn).toBe("system");
    expect(
      progressOf({ ...base, ...signedActive, requests: [{ ...approved, status: "proposed" }] })
        .waitingOn,
    ).toBe("dao");
  });

  test("a paid, ended work order is finished; a renewal decision waits on the agency", () => {
    const paid = request({ status: "paid", approved: "$1", paidAt: "2026-11-01T09:00:00.000Z" });
    const finished = progressOf({ ...base, ...signedActive, status: "ended", requests: [paid] });
    expect(finished).toMatchObject({ stage: "wrap_up", waitingOn: null, headline: "Finished" });
    expect(finished.steps.every((s) => s.state === "done")).toBe(true);
    expect(
      progressOf({
        ...base,
        ...signedActive,
        status: "ended",
        requests: [paid],
        renewalStatus: "needs_approval",
      }),
    ).toMatchObject({ waitingOn: "you", next: { kind: "renewal" } });
  });

  test("a declined request doesn't hide the newer one", () => {
    const p = progressOf({
      ...base,
      ...signedActive,
      requests: [
        request({ id: "r1", status: "rejected", createdAt: "2026-10-31T10:00:00.000Z" }),
        request({
          id: "r2",
          code: "DM-007-R2",
          status: "submitted",
          createdAt: "2026-10-31T12:00:00.000Z",
        }),
      ],
    });
    expect(p.next).toMatchObject({ kind: "approve", requestId: "r2" });
  });

  test("a terminated work order needs nothing", () => {
    const p = progressOf({ ...base, ...signedActive, status: "terminated" });
    expect(p).toMatchObject({ stage: "wrap_up", waitingOn: null, needsYou: false, next: null });
    expect(p.steps.at(-1)?.label).toBe("Terminated");
  });

  test("problems that don't block the next step are listed as needing attention", () => {
    const p = progressOf({
      ...base,
      ...signedActive,
      esignError: "Couldn't check Documenso",
      driveError: "403",
      payeeNeedsConfirmation: true,
    });
    expect(p.attention.map((a) => a.key)).toEqual(["esign", "payee", "drive"]);
  });
});
