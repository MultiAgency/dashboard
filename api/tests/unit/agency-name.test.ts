import { describe, expect, test } from "vitest";
import { isPlaceholderAgencyName } from "../../src/lib/agency-name";

describe("isPlaceholderAgencyName", () => {
  test("flags empty, short and placeholder names", () => {
    for (const name of ["", "  ", "ab", "test", "Test", "DEMO", "Agency", "my  agency", null]) {
      expect(isPlaceholderAgencyName(name)).toBe(true);
    }
  });

  test("flags a name equal to the organization id", () => {
    expect(isPlaceholderAgencyName("org_8f3k2", "org_8f3k2")).toBe(true);
  });

  test("accepts a real agency name", () => {
    expect(isPlaceholderAgencyName("Studio Nine", "org_8f3k2")).toBe(false);
    expect(isPlaceholderAgencyName("Testnet Builders")).toBe(false);
  });
});
