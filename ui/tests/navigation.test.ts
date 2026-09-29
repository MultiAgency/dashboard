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
      ["projects", "reports", "engagements", "builders", "team", "settings"],
    ],
    [
      "money only with an Agency DAO",
      "admin",
      true,
      false,
      ["projects", "reports", "engagements", "builders", "team", "billings", "budgets", "settings"],
    ],
    [
      "members the screens they can use, without management links",
      "member",
      true,
      true,
      ["projects", "reports", "builders", "billings", "budgets", "agencies"],
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

    expect(groups.find((g) => g.title === "as client")?.items).toEqual([
      { to: "/client", label: "agencies" },
    ]);
  });
});

describe("clientEngagementSections", () => {
  it("gives Client members every section of their Engagement, Prepayments and the plan included", () => {
    expect(clientEngagementSections("e1", "client")).toEqual([
      { to: "/client/e1", label: "overview" },
      { to: "/client/e1/projects", label: "shared projects" },
      { to: "/client/e1/prepayments", label: "prepayments" },
      { to: "/client/e1/plan", label: "plan & change orders" },
      { to: "/client/e1/billings", label: "billings" },
      { to: "/client/e1/reports", label: "reports" },
      { to: "/client/e1/ideas", label: "ideas" },
    ]);
  });

  it("leaves out ideas for a Subcontractor, who does not submit ideas to the hiring Agency", () => {
    expect(clientEngagementSections("e1", "subcontract").map((s) => s.label)).not.toContain(
      "ideas",
    );
  });
});
