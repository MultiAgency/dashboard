import { describe, expect, test } from "vitest";
import { nextCycle } from "../src/lib/budget-periods";
import {
  defaultPeriod,
  duplicateTitle,
  recentBudgets,
  todayIn,
} from "../src/lib/work-order-defaults";

describe("todayIn", () => {
  test("reads the day in the agency's time zone", () => {
    const now = new Date("2026-10-26T23:30:00.000Z");
    expect(todayIn("UTC", now)).toBe("2026-10-26");
    expect(todayIn("Asia/Tokyo", now)).toBe("2026-10-27");
    expect(todayIn("America/Los_Angeles", now)).toBe("2026-10-26");
  });

  test("falls back to the local day without a valid time zone", () => {
    const now = new Date(2026, 9, 26, 12);
    expect(todayIn(null, now)).toBe("2026-10-26");
    expect(todayIn("Not/AZone", now)).toBe("2026-10-26");
  });
});

describe("defaultPeriod", () => {
  test("runs from today to the end of the month", () => {
    expect(defaultPeriod("2026-10-26")).toEqual({ start: "2026-10-26", end: "2026-10-31" });
    expect(defaultPeriod("2026-02-01")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(defaultPeriod("2026-10-28")).toEqual({ start: "2026-10-28", end: "2026-10-31" });
  });

  test("in the last three days of a month it takes the whole next month", () => {
    expect(defaultPeriod("2026-10-29")).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(defaultPeriod("2026-10-31")).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(defaultPeriod("2028-02-27")).toEqual({ start: "2028-03-01", end: "2028-03-31" });
    expect(defaultPeriod("2026-12-30")).toEqual({ start: "2027-01-01", end: "2027-01-31" });
  });
});

describe("the period of a duplicate", () => {
  test("a whole month is followed by the next whole month", () => {
    expect(nextCycle("2026-09-01", "2026-09-30")).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
    });
  });

  test("a partial period keeps its number of days", () => {
    expect(nextCycle("2026-10-05", "2026-10-18")).toEqual({
      start: "2026-10-19",
      end: "2026-11-01",
    });
  });
});

describe("duplicateTitle", () => {
  test("moves a month in the title to the new period", () => {
    expect(duplicateTitle("Contributor role September 2026", "2026-09-01", "2026-10-01")).toBe(
      "Contributor role October 2026",
    );
    expect(duplicateTitle("Retainer Dec 2026", "2026-12-01", "2027-01-01")).toBe(
      "Retainer Jan 2027",
    );
    expect(duplicateTitle("Retainer 2026-09", "2026-09-01", "2026-10-01")).toBe("Retainer 2026-10");
  });

  test("keeps any other title and drops a copy suffix", () => {
    expect(duplicateTitle("Contributor role", "2026-09-01", "2026-10-01")).toBe("Contributor role");
    expect(duplicateTitle("Contributor role (copy)", "2026-09-01", "2026-10-01")).toBe(
      "Contributor role",
    );
  });
});

describe("recentBudgets", () => {
  const wo = (tokenId: string, budgetAmount: string, createdAt: string) => ({
    tokenId,
    budgetAmount,
    createdAt,
  });

  test("lists the last three distinct budgets, newest first", () => {
    expect(
      recentBudgets([
        wo("usd", "1000000000", "2026-07-01T00:00:00Z"),
        wo("usd", "2000000000", "2026-10-01T00:00:00Z"),
        wo("usd", "2000000000", "2026-09-01T00:00:00Z"),
        wo("near", "2000000000", "2026-08-15T00:00:00Z"),
        wo("usd", "3000000000", "2026-08-01T00:00:00Z"),
      ]),
    ).toEqual([
      { tokenId: "usd", budgetAmount: "2000000000" },
      { tokenId: "near", budgetAmount: "2000000000" },
      { tokenId: "usd", budgetAmount: "3000000000" },
    ]);
  });

  test("is empty without work orders", () => {
    expect(recentBudgets([])).toEqual([]);
  });
});
