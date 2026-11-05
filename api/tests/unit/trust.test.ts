import { describe, expect, test } from "vitest";
import type { ConsistencyResult } from "../../src/services/work-orders/consistency";
import {
  assessTrust,
  type CurrentRequestFacts,
  committedOverlaps,
  DEFAULT_TRUST,
  type EvidenceFacts,
  evidenceFacts,
  isCleanPeriod,
  type PastRequest,
  type TrustHistory,
  trustConfigOf,
} from "../../src/services/work-orders/trust";

const NOW = new Date("2026-10-23T12:00:00.000Z");
const CONSISTENT: ConsistencyResult = { verdict: "consistent", concerns: [], confidence: 0.9 };

const facts = (overrides: Partial<EvidenceFacts> = {}): EvidenceFacts => ({
  authorized: 3,
  unauthorized: 0,
  flagged: 0,
  unapprovedPrs: 0,
  selfAssignedOnly: 0,
  ...overrides,
});

function paidPeriods(count: number, overrides: Partial<PastRequest> = {}): PastRequest[] {
  return Array.from({ length: count }, (_, i) => {
    const month = String(9 - i).padStart(2, "0");
    return {
      id: `r${i}`,
      workOrderId: "wo1",
      status: "paid",
      coversFrom: `2026-${month}-01`,
      coversTo: `2026-${month}-28`,
      requestedAmount: "100",
      approvedAmount: "100",
      submittedAt: `2026-${month}-29T00:00:00.000Z`,
      decidedAt: `2026-${month}-29T00:00:00.000Z`,
      paidAt: `2026-${month}-30T00:00:00.000Z`,
      evidence: facts(),
      ...overrides,
    };
  });
}

function history(overrides: Partial<TrustHistory> = {}): TrustHistory {
  return {
    builderNearAccount: "carol.near",
    firstWorkOrderStart: "2026-04-01",
    payeePaidBefore: true,
    requests: paidPeriods(5),
    renewals: [],
    ...overrides,
  };
}

function current(overrides: Partial<CurrentRequestFacts> = {}): CurrentRequestFacts {
  return {
    amount: "100",
    proratedCap: "100",
    remaining: "500",
    evidence: facts(),
    overlaps: [],
    payeeConfirmed: true,
    ...overrides,
  };
}

const AUTO = { mode: "auto" as const };

describe("evidenceFacts", () => {
  test("counts authorized work, ignores reviews for authorization and benign flags", () => {
    expect(
      evidenceFacts([
        { kind: "merged_pr", authorized: true, flags: [] },
        {
          kind: "assigned_issue",
          authorized: false,
          flags: ["assigned by the contractor themselves"],
        },
        { kind: "review", authorized: true, flags: [] },
        { kind: "assigned_issue", authorized: true, flags: ["assignment time unknown"] },
        {
          kind: "merged_pr",
          authorized: false,
          flags: [
            "not approved by the repository owner (@owner)",
            "closes only issues the contractor assigned to themselves",
          ],
        },
      ]),
    ).toEqual({
      authorized: 2,
      unauthorized: 2,
      flagged: 2,
      unapprovedPrs: 1,
      selfAssignedOnly: 1,
    });
  });
});

describe("isCleanPeriod", () => {
  test("needs paid status, authorized evidence, no unapproved PRs and no overlapping rejection", () => {
    const [paid] = paidPeriods(1) as [PastRequest];
    expect(isCleanPeriod(paid, [paid])).toBe(true);
    expect(isCleanPeriod({ ...paid, status: "approved" }, [])).toBe(false);
    expect(isCleanPeriod({ ...paid, evidence: facts({ authorized: 0 }) }, [])).toBe(false);
    expect(isCleanPeriod({ ...paid, evidence: facts({ unapprovedPrs: 1 }) }, [])).toBe(false);
    const rejected = { ...paid, id: "rx", status: "rejected" as const };
    expect(isCleanPeriod(paid, [paid, rejected])).toBe(false);
    expect(isCleanPeriod(paid, [paid, { ...rejected, workOrderId: "wo2" }])).toBe(true);
  });
});

describe("tiers", () => {
  test("no history is new and manual", () => {
    const result = assessTrust(
      history({ requests: [], firstWorkOrderStart: null, payeePaidBefore: false }),
      current(),
      CONSISTENT,
      AUTO,
      NOW,
    );
    expect(result.tier).toBe("new");
    expect(result.decision).toBe("manual");
    expect(result.vetoHours).toBe(0);
  });

  test("one clean period is still new", () => {
    expect(
      assessTrust(history({ requests: paidPeriods(1) }), current(), CONSISTENT, AUTO, NOW).tier,
    ).toBe("new");
  });

  test("two clean periods is established with a veto window", () => {
    const result = assessTrust(
      history({ requests: paidPeriods(2) }),
      current(),
      CONSISTENT,
      AUTO,
      NOW,
    );
    expect(result.tier).toBe("established");
    expect(result.blockers).toEqual([]);
    expect(result.decision).toBe("veto_window");
    expect(result.vetoHours).toBe(24);
  });

  test("four clean periods, 60 days tenure and no recent flags is trusted and auto-pays", () => {
    const result = assessTrust(history(), current(), CONSISTENT, AUTO, NOW);
    expect(result.tier).toBe("trusted");
    expect(result.decision).toBe("auto_pay");
    expect(result.vetoHours).toBe(0);
    expect(result.cleanPeriods).toBe(5);
  });

  test("short tenure keeps a builder established", () => {
    const result = assessTrust(
      history({ firstWorkOrderStart: "2026-09-01" }),
      current(),
      CONSISTENT,
      AUTO,
      NOW,
    );
    expect(result.tier).toBe("established");
    expect(result.reasons.join(" ")).toContain("60 days");
  });

  test("flags in the last three periods keep a builder established", () => {
    const requests = paidPeriods(5);
    requests[1] = { ...requests[1], evidence: facts({ flagged: 1 }) } as PastRequest;
    const result = assessTrust(history({ requests }), current(), CONSISTENT, AUTO, NOW);
    expect(result.tier).toBe("established");
  });

  test("older flags do not block trusted", () => {
    const requests = paidPeriods(5);
    requests[4] = { ...requests[4], evidence: facts({ flagged: 2 }) } as PastRequest;
    expect(assessTrust(history({ requests }), current(), CONSISTENT, AUTO, NOW).tier).toBe(
      "trusted",
    );
  });

  test("a recent rejection drops any builder to new", () => {
    const requests: PastRequest[] = [
      ...paidPeriods(5),
      {
        ...(paidPeriods(1)[0] as PastRequest),
        id: "bad",
        workOrderId: "wo2",
        status: "rejected",
        decidedAt: "2026-10-01T00:00:00.000Z",
      },
    ];
    const result = assessTrust(history({ requests }), current(), CONSISTENT, AUTO, NOW);
    expect(result.tier).toBe("new");
    expect(result.decision).toBe("manual");
    expect(result.reasons.join(" ")).toContain("rejected or failed");
  });

  test("an old failure outside the window does not reset the tier", () => {
    const requests: PastRequest[] = [
      ...paidPeriods(5),
      {
        ...(paidPeriods(1)[0] as PastRequest),
        id: "old",
        workOrderId: "wo0",
        status: "failed",
        coversFrom: "2026-01-01",
        coversTo: "2026-01-28",
        decidedAt: "2026-02-01T00:00:00.000Z",
      },
    ];
    expect(assessTrust(history({ requests }), current(), CONSISTENT, AUTO, NOW).tier).toBe(
      "trusted",
    );
  });

  test("paid periods without authorized evidence are not clean", () => {
    const result = assessTrust(
      history({ requests: paidPeriods(5, { evidence: facts({ authorized: 0 }) }) }),
      current(),
      CONSISTENT,
      AUTO,
      NOW,
    );
    expect(result.tier).toBe("new");
    expect(result.cleanPeriods).toBe(0);
  });
});

describe("blockers", () => {
  const cases: [string, Partial<CurrentRequestFacts>, Partial<TrustHistory>, string][] = [
    [
      "zero authorized evidence",
      { evidence: facts({ authorized: 0 }) },
      {},
      "No authorized evidence",
    ],
    ["amount above prorated cap", { amount: "101" }, {}, "above the cap"],
    ["amount above remaining", { amount: "100", remaining: "99" }, {}, "remaining budget"],
    ["overlapping dates", { overlaps: ["WO-1-R2"] }, {}, "overlap with WO-1-R2"],
    [
      "unapproved PRs",
      { evidence: facts({ unapprovedPrs: 1 }) },
      {},
      "not approved by the repository owner",
    ],
    ["self-assigned only", { evidence: facts({ selfAssignedOnly: 2 }) }, {}, "self-assigned"],
    ["payee never paid", {}, { payeePaidBefore: false }, "never been paid"],
    ["payee new to agency override", { payeeNewToAgency: true }, {}, "never been paid"],
    ["payee unconfirmed", { payeeConfirmed: false }, {}, "not confirmed"],
  ];

  for (const [name, facts_, hist, message] of cases) {
    test(`${name} forces manual even for trusted builders`, () => {
      const result = assessTrust(history(hist), current(facts_), CONSISTENT, AUTO, NOW);
      expect(result.decision).toBe("manual");
      expect(result.suggested).toBe("manual");
      expect(result.blockers.join(" | ")).toContain(message);
    });
  }

  test("amount equal to the cap and remaining is allowed", () => {
    const result = assessTrust(
      history(),
      current({ amount: "100", proratedCap: "100", remaining: "100" }),
      CONSISTENT,
      AUTO,
      NOW,
    );
    expect(result.blockers).toEqual([]);
  });

  test("amounts compare as big integers", () => {
    const result = assessTrust(
      history(),
      current({
        amount: "1000000000000000000000001",
        proratedCap: "1000000000000000000000000",
        remaining: "9000000000000000000000000",
      }),
      CONSISTENT,
      AUTO,
      NOW,
    );
    expect(result.blockers.join(" ")).toContain("above the cap");
  });
});

describe("AI check can only slow things down", () => {
  test("inconsistent verdict blocks a trusted builder and surfaces concerns", () => {
    const result = assessTrust(
      history(),
      current(),
      { verdict: "inconsistent", concerns: ["Claims a release with no PR"], confidence: 0.95 },
      AUTO,
      NOW,
    );
    expect(result.decision).toBe("manual");
    expect(result.blockers.join(" ")).toContain("inconsistent");
    expect(result.reasons).toContain("AI concern: Claims a release with no PR");
  });

  test("concerns verdict blocks", () => {
    const result = assessTrust(
      history(),
      current(),
      { verdict: "concerns", concerns: [], confidence: 0.9 },
      AUTO,
      NOW,
    );
    expect(result.decision).toBe("manual");
  });

  test("low-confidence consistent verdict blocks", () => {
    const result = assessTrust(
      history(),
      current(),
      { verdict: "consistent", concerns: [], confidence: 0.59 },
      AUTO,
      NOW,
    );
    expect(result.blockers.join(" ")).toContain("unsure");
    expect(result.decision).toBe("manual");
  });

  test("unavailable AI blocks established builders by default", () => {
    const result = assessTrust(history({ requests: paidPeriods(2) }), current(), null, AUTO, NOW);
    expect(result.tier).toBe("established");
    expect(result.decision).toBe("manual");
    expect(result.blockers.join(" ")).toContain("unavailable");
  });

  test("unavailable AI downgrades trusted builders to the veto window", () => {
    const result = assessTrust(history(), current(), null, AUTO, NOW);
    expect(result.tier).toBe("trusted");
    expect(result.blockers).toEqual([]);
    expect(result.decision).toBe("veto_window");
    expect(result.vetoHours).toBe(24);
  });

  test("requiring AI for trusted makes unavailability a blocker", () => {
    const result = assessTrust(
      history(),
      current(),
      null,
      { mode: "auto", requireAi: { trusted: true } },
      NOW,
    );
    expect(result.decision).toBe("manual");
  });

  test("not requiring AI for established lets the veto window proceed", () => {
    const result = assessTrust(
      history({ requests: paidPeriods(2) }),
      current(),
      null,
      { mode: "auto", requireAi: { established: false } },
      NOW,
    );
    expect(result.decision).toBe("veto_window");
  });

  test("a consistent AI verdict never lifts a new builder out of manual", () => {
    const result = assessTrust(
      history({ requests: [] }),
      current(),
      { verdict: "consistent", concerns: [], confidence: 1 },
      AUTO,
      NOW,
    );
    expect(result.decision).toBe("manual");
  });
});

describe("modes", () => {
  test("default mode is suggest: computes the suggestion but stays manual", () => {
    const result = assessTrust(history(), current(), CONSISTENT, {}, NOW);
    expect(DEFAULT_TRUST.mode).toBe("suggest");
    expect(result.suggested).toBe("auto_pay");
    expect(result.decision).toBe("manual");
    expect(result.reasons.join(" ")).toContain("suggest mode");
  });

  test("off mode is always manual", () => {
    const result = assessTrust(history(), current(), CONSISTENT, { mode: "off" }, NOW);
    expect(result.decision).toBe("manual");
    expect(result.reasons.join(" ")).toContain("off");
  });

  test("custom veto hours and thresholds apply", () => {
    const result = assessTrust(
      history({ requests: paidPeriods(1) }),
      current(),
      CONSISTENT,
      { mode: "auto", establishedMinCleanPeriods: 1, vetoHours: 6 },
      NOW,
    );
    expect(result.decision).toBe("veto_window");
    expect(result.vetoHours).toBe(6);
  });
});

describe("score", () => {
  test("stays within 0..100 and rewards history", () => {
    const strong = assessTrust(
      history({
        requests: paidPeriods(8),
        firstWorkOrderStart: "2025-01-01",
        renewals: [
          { workOrderId: "a", status: "renewed", passed: true },
          { workOrderId: "b", status: "renewed", passed: true },
          { workOrderId: "c", status: "renewed", passed: true },
        ],
      }),
      current(),
      CONSISTENT,
      AUTO,
      NOW,
    ).score;
    const weak = assessTrust(
      history({
        requests: paidPeriods(3, { status: "rejected", decidedAt: "2026-10-20T00:00:00.000Z" }),
        payeePaidBefore: false,
        renewals: [{ workOrderId: "x", status: "declined", passed: false }],
      }),
      current(),
      CONSISTENT,
      AUTO,
      NOW,
    ).score;
    expect(strong).toBeLessThanOrEqual(100);
    expect(strong).toBeGreaterThan(80);
    expect(weak).toBe(0);
  });
});

describe("helpers", () => {
  test("trustConfigOf merges nested requireAi", () => {
    expect(trustConfigOf({ requireAi: { trusted: true } }).requireAi).toEqual({
      established: true,
      trusted: true,
    });
  });

  test("committedOverlaps lists committed siblings with overlapping dates", () => {
    expect(
      committedOverlaps({ id: "a", coversFrom: "2026-09-10", coversTo: "2026-09-20" }, [
        { id: "a", status: "paid", coversFrom: "2026-09-10", coversTo: "2026-09-20" },
        { id: "b", status: "paid", coversFrom: "2026-09-01", coversTo: "2026-09-10" },
        { id: "c", status: "rejected", coversFrom: "2026-09-01", coversTo: "2026-09-30" },
        { id: "d", status: "approved", coversFrom: "2026-09-21", coversTo: "2026-09-30" },
      ]),
    ).toEqual(["b"]);
  });
});
