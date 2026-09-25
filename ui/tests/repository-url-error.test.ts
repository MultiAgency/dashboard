import { describe, expect, test } from "vitest";
import { repositoryUrlError } from "../src/lib/url";

const repositoryRequired = Object.assign(new Error("Projects require a repository URL"), {
  code: "BAD_REQUEST",
  data: { reason: "REPOSITORY_REQUIRED" },
});

describe("repositoryUrlError", () => {
  test("an empty field says nothing until the form is submitted", () => {
    expect(repositoryUrlError("", { submitted: false })).toBeNull();
    expect(repositoryUrlError("  ", { submitted: true })).toBe(
      "Enter the repository URL for the new Project",
    );
  });

  test("a value that is not an http(s) URL is flagged as soon as it is typed", () => {
    expect(repositoryUrlError("github.com/org/repo", { submitted: false })).toBe(
      "Enter a full http(s) URL",
    );
    expect(repositoryUrlError("https://github.com/org/repo", { submitted: true })).toBeNull();
  });

  test("shows the API's message when it refuses a Project without a repository", () => {
    expect(repositoryUrlError("", { submitted: false, error: repositoryRequired })).toBe(
      "Projects require a repository URL",
    );
    expect(
      repositoryUrlError("https://github.com/org/repo", {
        submitted: true,
        error: new Error("This idea was already accepted or declined."),
      }),
    ).toBeNull();
  });
});
