import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const FORM_FILES = ["apply.tsx", "register.tsx", "contact.tsx"];

function read(...segments: string[]): string {
  return readFileSync(resolve(import.meta.dirname, "..", "src", ...segments), "utf8");
}

describe("shared inquiry field a11y surface", () => {
  const source = read("components", "inquiry-form.tsx");

  test("marks inputs aria-invalid when errors exist", () => {
    expect(source).toMatch(/aria-invalid=\{error \? true : undefined\}/);
  });

  test("links inputs to the error message via aria-describedby", () => {
    expect(source).toMatch(/error \? errorId : null/);
    expect(source).toMatch(/aria-describedby=\{describedBy\}/);
  });

  test('announces errors with aria-live="polite", not role="alert"', () => {
    expect(source).toMatch(/aria-live="polite"/);
    expect(source).not.toMatch(/role="alert"/);
  });
});

describe("intake form a11y surface", () => {
  for (const file of FORM_FILES) {
    const source = read("routes", "_layout", file);

    test(`${file} renders its text fields through the shared inquiry field`, () => {
      expect(source).toMatch(/<InquiryTextField/);
    });

    test(`${file} runs validateAllFields("submit") so empty-submit surfaces errors`, () => {
      expect(source).toMatch(/validateAllFields\("submit"\)/);
    });

    test(`${file} validators include onSubmit, not just onChange`, () => {
      expect(source).toMatch(/onChange:\s*\w+Schema,\s*onSubmit:\s*\w+Schema/);
    });
  }
});
