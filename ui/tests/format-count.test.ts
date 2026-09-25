import { describe, expect, test } from "vitest";
import { formatCount } from "@/lib/format-count";

describe("formatCount", () => {
  test("shows counts up to nine as they are", () => {
    expect(formatCount(1)).toBe("1");
    expect(formatCount(9)).toBe("9");
  });

  test("caps larger counts at 9+", () => {
    expect(formatCount(10)).toBe("9+");
    expect(formatCount(250)).toBe("9+");
  });
});
