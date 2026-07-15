import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const source = readFileSync(
  resolve(import.meta.dirname, "..", "src", "routes", "_layout", "treasury.tsx"),
  "utf8",
);

describe("proposals-list — STATUS_ROW_TINT map covers every status with the expected class", () => {
  test("Failed maps to bg-destructive/5 (action-worthy: technical execution failure)", () => {
    expect(source).toMatch(/Failed:\s*"bg-destructive\/5"/);
  });

  test("Rejected/Removed/Expired/Moved all map to bg-muted/40 (closed-without-execution)", () => {
    expect(source).toMatch(/Rejected:\s*"bg-muted\/40"/);
    expect(source).toMatch(/Removed:\s*"bg-muted\/40"/);
    expect(source).toMatch(/Expired:\s*"bg-muted\/40"/);
    expect(source).toMatch(/Moved:\s*"bg-muted\/40"/);
  });

  test("InProgress and Approved are not tinted (Badge already carries primary status signal)", () => {
    expect(source).toMatch(/InProgress:\s*""/);
    expect(source).toMatch(/Approved:\s*""/);
  });

  test("tint is applied to the TableRow className via STATUS_ROW_TINT lookup", () => {
    expect(source).toMatch(/STATUS_ROW_TINT\[proposal\.status\]/);
    expect(source).toMatch(/STATUS_ROW_TINT\[proposal\.status\]\s*\?\?\s*""/);
  });
});

describe("proposals-list — VoteTally renders all three vote actions conditionally", () => {
  test("approve count always renders (most common positive signal)", () => {
    expect(source).toMatch(/approve<\/span>\s*\{counts\.Approve\}/);
  });

  test("reject count always renders (most common negative signal)", () => {
    expect(source).toMatch(/reject<\/span>\s*\{counts\.Reject\}/);
  });

  test("remove count renders only when > 0 (rare action; would clutter common cases)", () => {
    expect(source).toMatch(/\{counts\.Remove\s*>\s*0\s*&&/);
    expect(source).toMatch(/remove<\/span>\s*\{counts\.Remove\}/);
  });

  test('empty vote record renders "no tally available" (cache-served terminals carry {})', () => {
    expect(source).toMatch(/entries\.length\s*===\s*0/);
    expect(source).toMatch(/no tally available/);
  });

  test("tally aggregation iterates over Object.values(votes) — order-independent count", () => {
    expect(source).toMatch(/Object\.values\(votes\)/);
    expect(source).toMatch(/for\s*\(const\s+v\s+of\s+entries\)\s*counts\[v\]\+\+/);
  });
});
