import { describe, expect, it } from "vitest";
import { moveLink } from "../src/lib/agent-links";

describe("moveLink", () => {
  it("moves a link one place up or down and leaves the ends alone", () => {
    expect(moveLink(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveLink(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(moveLink(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveLink(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(moveLink(["a", "b"], "x", 1)).toEqual(["a", "b"]);
  });
});
