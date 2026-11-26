import { describe, expect, test } from "vitest";
import { platformSettings } from "../../src/services/platform/client";

const good = {
  PLATFORM_URL: "https://api.dev.multiagency.ai",
  PLATFORM_APP_CREDENTIAL: "tap_abc.def",
  PLATFORM_DEPLOYMENT: "multiagency-dashboard",
};

describe("platform settings", () => {
  test("all three set give the host the texts are bound to", () => {
    expect(platformSettings(good)).toEqual({
      base: "https://api.dev.multiagency.ai",
      host: "api.dev.multiagency.ai",
      deployment: "multiagency-dashboard",
      credential: "tap_abc.def",
    });
    expect(platformSettings({ ...good, PLATFORM_URL: "https://localhost:54321/" })?.host).toBe(
      "localhost:54321",
    );
  });

  test.each([
    ["no URL", { PLATFORM_URL: undefined }],
    ["no credential", { PLATFORM_APP_CREDENTIAL: "" }],
    ["no deployment", { PLATFORM_DEPLOYMENT: " " }],
    ["plain HTTP", { PLATFORM_URL: "http://api.dev.multiagency.ai" }],
    ["a path", { PLATFORM_URL: "https://api.dev.multiagency.ai/apps/v1" }],
    ["a query", { PLATFORM_URL: "https://api.dev.multiagency.ai/?x=1" }],
    ["not a URL", { PLATFORM_URL: "api.dev.multiagency.ai" }],
    ["a credential that isn't an app credential", { PLATFORM_APP_CREDENTIAL: "naa_abc" }],
    ["an invalid deployment name", { PLATFORM_DEPLOYMENT: "Multiagency Dashboard" }],
  ])("%s turns platform access off", (_name, patch) => {
    expect(platformSettings({ ...good, ...patch })).toBeNull();
  });
});
