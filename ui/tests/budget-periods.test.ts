import { describe, expect, test } from "vitest";
import { formatPeriod, nextCycle, periodError } from "../src/lib/budget-periods";

describe("nextCycle", () => {
  test("a mid-month retainer moves on by a month", () => {
    expect(nextCycle("2026-07-15", "2026-08-14")).toEqual({
      start: "2026-08-15",
      end: "2026-09-14",
    });
    expect(nextCycle("2026-08-15", "2026-09-14")).toEqual({
      start: "2026-09-15",
      end: "2026-10-14",
    });
  });

  test("a calendar month moves to the next calendar month", () => {
    expect(nextCycle("2026-09-01", "2026-09-30")).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
    });
    expect(nextCycle("2026-01-01", "2026-01-31")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });

  test("a part month ending on the last day continues with the next full month", () => {
    expect(nextCycle("2026-09-15", "2026-09-30")).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
    });
  });

  test("a quarter moves on by three months", () => {
    expect(nextCycle("2026-07-15", "2026-10-14")).toEqual({
      start: "2026-10-15",
      end: "2027-01-14",
    });
  });

  test("any other range keeps its length in days", () => {
    expect(nextCycle("2026-09-03", "2026-09-16")).toEqual({
      start: "2026-09-17",
      end: "2026-09-30",
    });
  });
});

describe("formatPeriod", () => {
  test("shows a range, or a single day", () => {
    expect(formatPeriod("2026-07-15", "2026-08-14")).toBe("2026-07-15 – 2026-08-14");
    expect(formatPeriod("2026-07-15", null)).toBe("2026-07-15");
    expect(formatPeriod("2026-07-15", "2026-07-15")).toBe("2026-07-15");
  });
});

describe("periodError", () => {
  test("needs a start before an end, and an end on or after the start", () => {
    expect(periodError("", "2026-09-30")).toMatch(/start date/);
    expect(periodError("2026-09-15", "2026-09-14")).toMatch(/on or after/);
    expect(periodError("2026-09-15", "")).toBeNull();
    expect(periodError("2026-09-15", "2026-09-15")).toBeNull();
  });
});
