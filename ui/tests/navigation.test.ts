import { describe, expect, it } from "vitest";
import {
  availableViews,
  clientEngagementSections,
  resolveView,
  viewForPath,
  workspaceNavigation,
} from "../src/lib/navigation";

const labels = (...args: Parameters<typeof workspaceNavigation>) =>
  workspaceNavigation(...args).flatMap((g) => g.items.map((i) => i.label));

describe("workspaceNavigation", () => {
  it.each([
    ["nothing to someone without a role", null, true, true, []],
    [
      "every Organization the Agency sections",
      "owner",
      false,
      false,
      ["Projects", "Reports", "Engagements", "Builders", "Team", "Settings"],
    ],
    [
      "money only with an Agency DAO",
      "admin",
      true,
      false,
      ["Projects", "Reports", "Engagements", "Builders", "Team", "Billings", "Budgets", "Settings"],
    ],
    [
      "members the screens they can use, without management links",
      "member",
      true,
      true,
      ["Projects", "Reports", "Builders", "Billings", "Budgets"],
    ],
  ] as const)("gives %s", (_, role, hasAgencyDao, hasClientSections, expected) => {
    expect(
      labels({ role, hasAgencyDao, hasAgencySections: true, hasClientSections }, "agency"),
    ).toEqual(expected);
  });

  it("gives a Client-only Organization the client screens and no Agency setup", () => {
    const groups = workspaceNavigation({
      role: "owner",
      hasAgencyDao: false,
      hasAgencySections: false,
      hasClientSections: true,
    });

    expect(groups.flatMap((g) => g.items)).toEqual([
      { to: "/client/projects", label: "Projects" },
      { to: "/client/reports", label: "Reports" },
      { to: "/client", label: "Agencies" },
      { to: "/admin/members", label: "Team" },
    ]);
  });

  it("leaves Team out of the client screens for members", () => {
    expect(
      labels(
        { role: "member", hasAgencyDao: false, hasAgencySections: false, hasClientSections: true },
        "client",
      ),
    ).toEqual(["Projects", "Reports", "Agencies"]);
  });
});

describe("viewing role", () => {
  const both = { hasAgencySections: true, hasClientSections: true };

  it("offers a switch only to Organizations that are both Agency and Client", () => {
    expect(availableViews(both)).toEqual(["agency", "client"]);
    expect(availableViews({ ...both, hasAgencySections: false })).toEqual(["client"]);
    expect(availableViews({ ...both, hasClientSections: false })).toEqual(["agency"]);
  });

  it("keeps a preferred view only when the Organization has it", () => {
    expect(resolveView(both, "client")).toBe("client");
    expect(resolveView(both, null)).toBe("agency");
    expect(resolveView({ ...both, hasAgencySections: false }, "agency")).toBe("client");
  });

  it("reads the view from the current page, with Team shared by both", () => {
    expect(viewForPath("/client/projects")).toBe("client");
    expect(viewForPath("/client")).toBe("client");
    expect(viewForPath("/admin/settings")).toBe("agency");
    expect(viewForPath("/admin/members")).toBeNull();
    expect(viewForPath("/dashboard")).toBeNull();
  });
});

describe("clientEngagementSections", () => {
  it("gives Client members every section of their Engagement, Prepayments and the plan included", () => {
    expect(clientEngagementSections("e1", "client")).toEqual([
      { to: "/client/e1", label: "Overview" },
      { to: "/client/e1/projects", label: "Shared projects" },
      { to: "/client/e1/prepayments", label: "Prepayments" },
      { to: "/client/e1/plan", label: "Plan & Change orders" },
      { to: "/client/e1/billings", label: "Billings" },
      { to: "/client/e1/reports", label: "Reports" },
      { to: "/client/e1/ideas", label: "Ideas" },
    ]);
  });

  it("leaves out ideas for a Subcontractor, who does not submit ideas to the hiring Agency", () => {
    expect(clientEngagementSections("e1", "subcontract").map((s) => s.label)).not.toContain(
      "Ideas",
    );
  });
});
