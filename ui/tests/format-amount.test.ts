import { describe, expect, test } from "vitest";
import { formatTokenAmount, parseDecimalToBase } from "../src/lib/format-amount";

const ONE_NEAR = "1000000000000000000000000";
const HALF_NEAR = "500000000000000000000000";
const ONE_AND_QUARTER_NEAR = "1250000000000000000000000";

describe("formatTokenAmount", () => {
  test("formats whole NEAR", () => {
    expect(formatTokenAmount(ONE_NEAR, "near")).toBe("1 NEAR");
  });

  test("formats fractional NEAR", () => {
    expect(formatTokenAmount(HALF_NEAR, "near")).toBe("0.5 NEAR");
  });

  test("trims trailing zeros from fractional part", () => {
    expect(formatTokenAmount(ONE_AND_QUARTER_NEAR, "near")).toBe("1.25 NEAR");
  });

  test("handles zero", () => {
    expect(formatTokenAmount("0", "near")).toBe("0 NEAR");
  });

  test("handles negative amounts (refunds/corrections)", () => {
    expect(formatTokenAmount(`-${ONE_NEAR}`, "near")).toBe("-1 NEAR");
  });

  test("formats wrap.near with same decimals as NEAR", () => {
    expect(formatTokenAmount(ONE_NEAR, "wrap.near")).toBe("1 wNEAR");
  });

  test("truncates fractional precision to 6 places", () => {
    const lowDigits = "1123456789012345678901234";
    expect(formatTokenAmount(lowDigits, "near")).toBe("1.123456 NEAR");
  });

  test("falls back to raw for unknown token", () => {
    expect(formatTokenAmount("100", "usdc.tkn.primitives.near")).toBe(
      "100 usdc.tkn.primitives.near",
    );
  });

  test("inserts thousand separators in the integer portion", () => {
    const twelveThousandNear = `12345${"0".repeat(24)}`;
    expect(formatTokenAmount(twelveThousandNear, "near")).toBe("12,345 NEAR");
    const oneMillionUsdc = `${1_000_000 * 1_000_000}`;
    expect(
      formatTokenAmount(
        oneMillionUsdc,
        "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
      ),
    ).toBe("1,000,000 USDC");
  });

  test("formats USDC (6 decimals) correctly after token-list expansion", () => {
    expect(
      formatTokenAmount(
        "1500000",
        "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
      ),
    ).toBe("1.5 USDC");
  });

  test("falls back to raw for invalid amount string", () => {
    expect(formatTokenAmount("not-a-number", "near")).toBe("not-a-number near");
  });
});

describe("parseDecimalToBase", () => {
  test("whole NEAR", () => {
    expect(parseDecimalToBase("1", 24)).toBe("1000000000000000000000000");
  });

  test("fractional NEAR", () => {
    expect(parseDecimalToBase("1.5", 24)).toBe("1500000000000000000000000");
  });

  test("zero", () => {
    expect(parseDecimalToBase("0", 24)).toBe("0");
    expect(parseDecimalToBase("0.0", 24)).toBe("0");
  });

  test("max-precision fractional", () => {
    expect(parseDecimalToBase("0.000001", 6)).toBe("1");
    expect(parseDecimalToBase("1.999999", 6)).toBe("1999999");
  });

  test("strips leading zeros", () => {
    expect(parseDecimalToBase("01.5", 24)).toBe("1500000000000000000000000");
    expect(parseDecimalToBase("00", 24)).toBe("0");
  });

  test("rejects more fractional digits than the token's decimals", () => {
    expect(() => parseDecimalToBase("1.1234567", 6)).toThrow(/Too many fractional digits/);
  });

  test("rejects negative amounts", () => {
    expect(() => parseDecimalToBase("-1", 24)).toThrow();
    expect(() => parseDecimalToBase("-1.5", 24)).toThrow();
  });

  test("rejects empty string", () => {
    expect(() => parseDecimalToBase("", 24)).toThrow(/Empty/);
    expect(() => parseDecimalToBase("   ", 24)).toThrow(/Empty/);
  });

  test("rejects non-numeric", () => {
    expect(() => parseDecimalToBase("abc", 24)).toThrow();
    expect(() => parseDecimalToBase("1.2.3", 24)).toThrow();
    expect(() => parseDecimalToBase("1e5", 24)).toThrow();
  });

  test("rejects bare decimal point", () => {
    expect(() => parseDecimalToBase(".", 24)).toThrow();
    expect(() => parseDecimalToBase(".5", 24)).toThrow();
    expect(() => parseDecimalToBase("1.", 24)).toThrow();
  });

  test("trims surrounding whitespace", () => {
    expect(parseDecimalToBase("  1.5  ", 24)).toBe("1500000000000000000000000");
  });

  test("handles tokens with zero decimals", () => {
    expect(parseDecimalToBase("100", 0)).toBe("100");
    expect(() => parseDecimalToBase("1.5", 0)).toThrow(/Too many fractional digits/);
  });
});
