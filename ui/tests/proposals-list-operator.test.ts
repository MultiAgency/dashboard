import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const source = readFileSync(
  resolve(import.meta.dirname, "..", "src", "routes", "_layout", "treasury.tsx"),
  "utf8",
);

describe("proposals-list operator overlay — structural commitments", () => {
  test("row attribution renders ONLY when showAttribution is true (operator path)", () => {
    expect(source).toMatch(/showAttribution\s*&&\s*proposal\.mapping/);
    expect(source).toMatch(/showAttribution\s*&&\s*!proposal\.mapping/);
  });

  test("unrecorded badge shows only for Approved proposals (terminal-fail has nothing to record)", () => {
    expect(source).toMatch(/proposal\.status\s*===\s*"Approved"/);
  });

  test("ProposalBillingSection only renders when operatorContext is passed", () => {
    expect(source).toMatch(/operatorContext\s*&&\s*[\s\S]*<ProposalBillingSection/);
  });

  test("billing record form requires a project selection (canRecord guard)", () => {
    expect(source).toMatch(/canRecord\s*=\s*projectId\s*!==\s*""/);
  });

  test("contributor field uses a non-empty sentinel (Radix Select forbids empty-string value)", () => {
    expect(source).toMatch(/NO_CONTRIBUTOR_SENTINEL\s*=\s*"__none__"/);
    expect(source).toMatch(/value=\{contributorId \|\| NO_CONTRIBUTOR_SENTINEL\}/);
    expect(source).toMatch(/===\s*NO_CONTRIBUTOR_SENTINEL\s*\?\s*""/);
  });

  test("delete affordance routes through ConfirmDialog (no window.confirm)", () => {
    expect(source).toMatch(/<ConfirmDialog/);
    expect(source).not.toMatch(/window\.confirm/);
  });

  test("recorded-billing path links to the project detail and exposes delete", () => {
    expect(source).toMatch(/to="\/admin\/projects\/\$slug"/);
    expect(source).toMatch(/proposal\.mapping\.projectSlug/);
  });

  test("billing mutations invalidate the full set of stale caches", () => {
    expect(source).toMatch(/\["proposals",\s*"list"\]/);
    expect(source).toMatch(/\["admin",\s*"billings",\s*"list"\]/);
    expect(source).toMatch(/\["admin",\s*"projects",\s*"budget"\]/);
    expect(source).toMatch(/\["treasury",\s*"rollups"\]/);
  });
});
