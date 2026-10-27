import { describe, expect, test } from "bun:test";
import { MergeConflict, mergeBosConfig } from "./merge-bos-config";

const config = (production: string, extra: Record<string, unknown> = {}) => ({
  app: {
    api: { production, integrity: `sha-${production}`, variables: { communityApiUrl: "a" } },
    auth: { variables: { baseUrl: "https://example.test" } },
  },
  plugins: { builders: { secrets: ["DB"], production } },
  ...extra,
});

describe("mergeBosConfig", () => {
  test("keeps the receiving branch's deployment URLs", () => {
    const base = config("base-url");
    const ours = config("staging-url");
    const theirs = config("main-url");

    expect(mergeBosConfig(base, ours, theirs)).toEqual(ours);
  });

  test("takes a real change from the incoming branch", () => {
    const base = config("base-url");
    const ours = config("staging-url");
    const theirs = config("main-url");
    theirs.plugins.builders.secrets = ["DB", "TOKEN"];

    const merged = mergeBosConfig(base, ours, theirs) as typeof ours;

    expect(merged.plugins.builders.secrets).toEqual(["DB", "TOKEN"]);
    expect(merged.plugins.builders.production).toBe("staging-url");
  });

  test("adds a key only the incoming branch has", () => {
    const merged = mergeBosConfig(
      config("base"),
      config("staging"),
      config("main", { repository: "https://example.test/repo" }),
    ) as Record<string, unknown>;

    expect(merged.repository).toBe("https://example.test/repo");
  });

  test("removes a key the incoming branch deleted", () => {
    const base = config("base", { title: "Old" });
    const merged = mergeBosConfig(base, config("staging", { title: "Old" }), config("main"));

    expect(merged).not.toHaveProperty("title");
  });

  test("keeps the receiving branch's own base URL", () => {
    const ours = config("staging");
    ours.app.auth.variables.baseUrl = "https://staging.example.test";

    const merged = mergeBosConfig(config("base"), ours, config("main")) as typeof ours;

    expect(merged.app.auth.variables.baseUrl).toBe("https://staging.example.test");
  });

  test("stops on a real conflict outside deployment fields", () => {
    const ours = config("staging");
    ours.plugins.builders.secrets = ["DB", "A"];
    const theirs = config("main");
    theirs.plugins.builders.secrets = ["DB", "B"];

    expect(() => mergeBosConfig(config("base"), ours, theirs)).toThrow(MergeConflict);
  });
  test("keeps the receiving branch's URL and integrity together", () => {
    const base = { plugins: { projects: { production: "base-url", integrity: "same-hash" } } };
    const ours = { plugins: { projects: { production: "staging-url", integrity: "same-hash" } } };
    const theirs = { plugins: { projects: { production: "main-url", integrity: "main-hash" } } };

    expect(mergeBosConfig(base, ours, theirs)).toEqual(ours);
  });
  test("keeps the receiving branch's URL when only the other side redeployed", () => {
    const base = { app: { ui: { production: "old-url", integrity: "old-hash" } } };
    const ours = base;
    const theirs = { app: { ui: { production: "main-url", integrity: "main-hash" } } };

    expect(mergeBosConfig(base, ours, theirs)).toEqual(ours);
  });
});
