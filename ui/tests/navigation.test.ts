import { describe, expect, it } from "vitest";
import { workspaceNavigation } from "../src/lib/navigation";

const labels = (groups: ReturnType<typeof workspaceNavigation>) =>
  groups.flatMap((g) => g.items.map((i) => i.label));

describe("workspaceNavigation", () => {
  it("gives nothing to someone without a role in the active Organization", () => {
    expect(
      workspaceNavigation({ role: null, hasAgencyDao: true, hasClientSections: true }),
    ).toEqual([]);
  });

  it("gives every Organization the Agency sections, and money only with an Agency DAO", () => {
    expect(
      labels(workspaceNavigation({ role: "owner", hasAgencyDao: false, hasClientSections: false })),
    ).toEqual(["projects", "reports", "engagements", "builders", "team", "settings"]);
    expect(
      labels(workspaceNavigation({ role: "admin", hasAgencyDao: true, hasClientSections: false })),
    ).toEqual([
      "projects",
      "reports",
      "engagements",
      "builders",
      "team",
      "billings",
      "budgets",
      "settings",
    ]);
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

  it("gives members the screens they can use, without management links", () => {
    expect(
      labels(workspaceNavigation({ role: "member", hasAgencyDao: true, hasClientSections: true })),
    ).toEqual(["projects", "reports", "builders", "billings", "budgets", "agencies"]);
  });
});
