import { describe, expect, it } from "vitest";
import {
  fixTarget,
  type SetupCheck,
  setupDismissKey,
  setupSummary,
  splitOptional,
} from "@/lib/setup-status";

const check = (over: Partial<SetupCheck>): SetupCheck => ({
  key: "k",
  label: "Check",
  state: "ok",
  detail: null,
  fixHref: null,
  required: true,
  ...over,
});

describe("setupSummary", () => {
  it("counts required checks and optional ones that are set up", () => {
    const summary = setupSummary([
      check({ key: "agency_name" }),
      check({
        key: "representative",
        state: "missing",
        fixHref: "/admin/settings#work-orders",
      }),
      check({ key: "signing", state: "warning" }),
      check({ key: "google", state: "optional", required: false }),
      check({ key: "payouts_agent", required: false }),
      check({ key: "payouts_funding", state: "warning", required: false }),
    ]);
    expect(summary).toMatchObject({ done: 2, total: 5, ready: false });
    expect(summary.blocking.map((c) => c.key)).toEqual(["representative"]);
    expect(summary.attention.map((c) => c.key)).toEqual([
      "representative",
      "signing",
      "payouts_funding",
    ]);
  });

  it("is ready when no required check is missing, even with warnings", () => {
    const summary = setupSummary([
      check({ key: "agency_name" }),
      check({ key: "signing", state: "warning" }),
      check({ key: "payouts_funding", state: "missing", required: false }),
    ]);
    expect(summary.ready).toBe(true);
  });

  it("flags server settings an agency can't fix without blocking", () => {
    const summary = setupSummary([
      check({ key: "agency_name", fixHref: null }),
      check({ key: "email", state: "missing", fixHref: null }),
    ]);
    expect(summary.ready).toBe(true);
    expect(summary.blocking).toEqual([]);
    expect(summary.attention.map((c) => c.key)).toEqual(["email"]);
  });
});

describe("splitOptional", () => {
  it("tucks away optional checks unless they need attention", () => {
    const { main, optional } = splitOptional([
      check({ key: "agency_name" }),
      check({ key: "google", state: "optional", required: false }),
      check({ key: "payouts_agent", required: false }),
      check({ key: "payouts_funding", state: "warning", required: false }),
    ]);
    expect(main.map((c) => c.key)).toEqual(["agency_name", "payouts_funding"]);
    expect(optional.map((c) => c.key)).toEqual(["google", "payouts_agent"]);
  });
});

describe("fixTarget", () => {
  it("splits the settings section out of the link", () => {
    expect(fixTarget("/admin/settings#payouts")).toEqual({
      path: "/admin/settings",
      hash: "payouts",
    });
    expect(fixTarget("/admin/settings")).toEqual({ path: "/admin/settings", hash: null });
  });
});

describe("setupDismissKey", () => {
  it("is per organization", () => {
    expect(setupDismissKey("org-1")).not.toBe(setupDismissKey("org-2"));
  });
});
