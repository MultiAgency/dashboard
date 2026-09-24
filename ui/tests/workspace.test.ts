import { describe, expect, test } from "vitest";
import { activeWorkspace, recoveryTarget } from "../src/lib/workspace";

const organizations = [
  { id: "agency", name: "Agency", slug: "agency", role: "owner" as const },
  { id: "legacy-client", name: "Legacy Client", slug: "legacy-client", role: "member" as const },
];

describe("workspace switcher", () => {
  test("keeps a valid active Organization, including a legacy Client Organization", () => {
    expect(activeWorkspace(organizations, "legacy-client")?.name).toBe("Legacy Client");
    expect(recoveryTarget(organizations, "legacy-client")).toBeNull();
    expect(recoveryTarget(organizations, "agency")).toBeNull();
  });

  test("recovers only when the active Organization is missing, personal or left", () => {
    expect(recoveryTarget(organizations, null)).toBe("agency");
    expect(recoveryTarget(organizations, "personal-org")).toBe("agency");
    expect(recoveryTarget([], null)).toBeNull();
  });
});
