import { describe, expect, it } from "vitest";
import { isAgentLinkUrl, moveLink } from "../src/lib/agent-links";

describe("isAgentLinkUrl", () => {
  it("accepts only http and https URLs", () => {
    expect(isAgentLinkUrl("https://agents.example/research")).toBe(true);
    expect(isAgentLinkUrl(" http://support.example ")).toBe(true);
    expect(isAgentLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isAgentLinkUrl("ftp://files.example")).toBe(false);
    expect(isAgentLinkUrl("agents.example")).toBe(false);
    expect(isAgentLinkUrl("https://")).toBe(false);
  });
});

describe("moveLink", () => {
  it("moves a link one place up or down and leaves the ends alone", () => {
    expect(moveLink(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveLink(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(moveLink(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveLink(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(moveLink(["a", "b"], "x", 1)).toEqual(["a", "b"]);
  });
});
