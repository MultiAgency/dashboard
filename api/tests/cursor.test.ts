import { describe, expect, it } from "vitest";
import { cursorOf, parseCursor } from "../src/db/cursor";

describe("parseCursor", () => {
  it("returns null for undefined", () => {
    expect(parseCursor(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseCursor("")).toBeNull();
  });

  it("returns null when the separator is missing", () => {
    expect(parseCursor("2025-01-01T00:00:00.000Z")).toBeNull();
  });

  it("returns null when the id half is empty", () => {
    expect(parseCursor("2025-01-01T00:00:00.000Z|")).toBeNull();
  });

  it("returns null for an unparseable timestamp", () => {
    expect(parseCursor("not-a-date|abc-123")).toBeNull();
  });

  it("parses a well-formed cursor", () => {
    expect(parseCursor("2025-01-01T00:00:00.000Z|abc-123")).toEqual({
      ts: new Date("2025-01-01T00:00:00.000Z"),
      id: "abc-123",
    });
  });

  it("treats only the first '|' as the separator (id may contain '|')", () => {
    expect(parseCursor("2025-01-01T00:00:00.000Z|abc|extra")?.id).toBe("abc|extra");
  });
});

describe("cursorOf", () => {
  it("encodes as <iso>|<id>", () => {
    expect(cursorOf(new Date("2025-01-01T00:00:00.000Z"), "row-1")).toBe(
      "2025-01-01T00:00:00.000Z|row-1",
    );
  });

  it("round-trips through parseCursor", () => {
    const ts = new Date("2025-06-15T12:34:56.000Z");
    const id = "row-id-123";
    const parsed = parseCursor(cursorOf(ts, id));
    expect(parsed?.ts.toISOString()).toBe(ts.toISOString());
    expect(parsed?.id).toBe(id);
  });
});
