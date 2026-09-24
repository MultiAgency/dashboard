import { describe, expect, test } from "vitest";
import {
  availableSlug,
  isOrganizationSlugTaken,
  isSlugTakenError,
  suggestSlug,
} from "../src/lib/slugify";

describe("slug suggestions", () => {
  test("append a counter to a taken slug and bump an existing one", () => {
    expect(suggestSlug("acme")).toBe("acme-2");
    expect(suggestSlug("acme-2")).toBe("acme-3");
    expect(suggestSlug("web3-site")).toBe("web3-site-2");
    expect(suggestSlug("2024")).toBe("2024-2");
  });

  test("stay within the slug length limit", () => {
    const suggestion = suggestSlug("a".repeat(80));

    expect(suggestion).toHaveLength(80);
    expect(suggestion.endsWith("-2")).toBe(true);
  });

  test("find the first free suggestion", async () => {
    const taken = new Set(["acme-2", "acme-3"]);

    expect(await availableSlug("acme", async (s) => taken.has(s))).toBe("acme-4");
    expect(await availableSlug("acme", async () => true, 3)).toBeNull();
  });

  test("recognise a taken-slug error from the API", () => {
    expect(
      isSlugTakenError({ data: { validationErrors: [{ field: "slug", code: "SLUG_TAKEN" }] } }),
    ).toBe(true);
    expect(isSlugTakenError(new Error("A project with this slug already exists"))).toBe(false);
    expect(isSlugTakenError(null)).toBe(false);
  });

  test("recognise a taken slug when creating an Organization", () => {
    expect(isOrganizationSlugTaken("ORGANIZATION_ALREADY_EXISTS")).toBe(true);
    expect(isOrganizationSlugTaken("ORGANIZATION_SLUG_ALREADY_TAKEN")).toBe(true);
    expect(isOrganizationSlugTaken("YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION")).toBe(false);
    expect(isOrganizationSlugTaken(undefined)).toBe(false);
  });
});
