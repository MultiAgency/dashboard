import { describe, expect, test } from "vitest";
import { githubProfileUrl } from "../src/lib/contributor-profile";

describe("githubProfileUrl", () => {
  test("links a user login to its profile", () => {
    expect(githubProfileUrl("ada")).toBe("https://github.com/ada");
  });

  test("links a GitHub App's bot login to the app", () => {
    expect(githubProfileUrl("near-builder[bot]")).toBe("https://github.com/apps/near-builder");
  });
});
