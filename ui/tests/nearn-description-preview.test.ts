import { describe, expect, test } from "vitest";
import { nearnDescriptionPreview } from "../src/lib/nearn";

describe("nearnDescriptionPreview", () => {
  test("strips TipTap HTML to plain text", () => {
    const html = `<h3 class="heading-node"><span>Overview</span></h3><p class="text-node"><span>We connect contributors with opportunities.</span></p>`;
    expect(nearnDescriptionPreview(html)).toBe(
      "Overview We connect contributors with opportunities.",
    );
  });

  test("returns null for empty input", () => {
    expect(nearnDescriptionPreview(null)).toBeNull();
    expect(nearnDescriptionPreview("   ")).toBeNull();
  });

  test("passes through plain text", () => {
    expect(nearnDescriptionPreview("Already plain")).toBe("Already plain");
  });
});
