import { describe, expect, it } from "vitest";
import { clientEngagementSections, workspaceNavigation } from "../src/lib/navigation";

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
      ["Projects", "Reports", "Builders", "Billings", "Budgets", "Agencies"],
    ],
  ] as const)("gives %s", (_, role, hasAgencyDao, hasClientSections, expected) => {
    expect(labels({ role, hasAgencyDao, hasClientSections })).toEqual(expected);
  });

  it("adds the Client sections when the Organization is a Client of an Agency", () => {
    const groups = workspaceNavigation({
      role: "admin",
      hasAgencyDao: false,
      hasClientSections: true,
    });

    expect(groups.find((g) => g.title === "As client")?.items).toEqual([
      { to: "/client", label: "Agencies" },
    ]);
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
