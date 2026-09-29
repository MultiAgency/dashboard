import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const source = readFileSync(
  resolve(import.meta.dirname, "..", "src", "routes", "_layout", "treasury.tsx"),
  "utf8",
);

describe("proposals-list — STATUS_ROW_VARIANT map covers every status with the expected row variant", () => {
  test("Failed maps to the destructive row (action-worthy: technical execution failure)", () => {
    expect(source).toMatch(/Failed:\s*"destructive"/);
  });

  test("Rejected/Removed/Expired/Moved all map to the muted row (closed-without-execution)", () => {
    expect(source).toMatch(/Rejected:\s*"muted"/);
    expect(source).toMatch(/Removed:\s*"muted"/);
    expect(source).toMatch(/Expired:\s*"muted"/);
    expect(source).toMatch(/Moved:\s*"muted"/);
  });

  test("InProgress and Approved are not tinted (Badge already carries primary status signal)", () => {
    expect(source).toMatch(/InProgress:\s*"default"/);
    expect(source).toMatch(/Approved:\s*"default"/);
  });

  test("the TableRow variant comes from the STATUS_ROW_VARIANT lookup", () => {
    expect(source).toMatch(/variant=\{STATUS_ROW_VARIANT\[proposal\.status\]\}/);
  });
});

describe("proposals-list — VoteTally renders all three vote actions conditionally", () => {
  test("approve count always renders (most common positive signal)", () => {
    expect(source).toMatch(/approve<\/span>\s*\{counts\.Approve\}/i);
  });

  test("reject count always renders (most common negative signal)", () => {
    expect(source).toMatch(/reject<\/span>\s*\{counts\.Reject\}/i);
  });

  test("remove count renders only when > 0 (rare action; would clutter common cases)", () => {
    expect(source).toMatch(/\{counts\.Remove\s*>\s*0\s*&&/);
    expect(source).toMatch(/remove<\/span>\s*\{counts\.Remove\}/i);
  });

  test('empty vote record renders "no tally available" (cache-served terminals carry {})', () => {
    expect(source).toMatch(/entries\.length\s*===\s*0/);
    expect(source).toMatch(/no tally available/i);
  });

  test("tally aggregation iterates over Object.values(votes) — order-independent count", () => {
    expect(source).toMatch(/Object\.values\(votes\)/);
    expect(source).toMatch(/for\s*\(const\s+v\s+of\s+entries\)\s*counts\[v\]\+\+/);
  });
});
