import { describe, expect, it } from "vitest";
import { toCsv } from "../src/lib/csv";

const csvOf = (value: string | number) =>
  toCsv([{ value }], [{ header: "v", value: (r) => r.value }]);

describe("toCsv", () => {
  it.each([
    '=HYPERLINK("x")',
    "+1",
    "-2+3",
    "@SUM(A1)",
    "\tTab",
  ])("stops %s from running as a spreadsheet formula", (value) => {
    expect(csvOf(value).split("\n")[1]?.replace(/^"|"$/g, "").startsWith("'")).toBe(true);
  });

  it("leaves numbers and ordinary text alone", () => {
    expect(csvOf(-5)).toBe("v\n-5");
    expect(csvOf("Ada Lovelace")).toBe("v\nAda Lovelace");
  });

  it("still quotes cells with commas", () => {
    expect(csvOf("=a,b")).toBe('v\n"\'=a,b"');
  });
});
