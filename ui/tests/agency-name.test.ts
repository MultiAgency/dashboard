import { describe, expect, it } from "vitest";
import { isPlaceholderAgencyName } from "@/lib/agency-name";

describe("isPlaceholderAgencyName", () => {
  it("flags empty, short and placeholder names", () => {
    for (const name of ["", "  ", "ab", "test", "Test", "DEMO", "Agency", "my  agency", null]) {
      expect(isPlaceholderAgencyName(name)).toBe(true);
    }
  });

  it("flags a name equal to the organization id", () => {
    expect(isPlaceholderAgencyName("org_8f3k2", "org_8f3k2")).toBe(true);
  });

  it("accepts a real agency name", () => {
    expect(isPlaceholderAgencyName("Studio Nine", "org_8f3k2")).toBe(false);
    expect(isPlaceholderAgencyName("Testnet Builders")).toBe(false);
  });
});
