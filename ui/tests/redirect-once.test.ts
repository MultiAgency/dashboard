import { describe, expect, test } from "vitest";
import { createRedirectOnce } from "../src/lib/account";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createRedirectOnce", () => {
  test("a second request while one is running joins it instead of navigating again", async () => {
    const redirectOnce = createRedirectOnce();
    const first = deferred();
    let calls = 0;
    const redirect = () => {
      calls += 1;
      return first.promise;
    };

    const fromEffect = redirectOnce(redirect);
    const fromSignIn = redirectOnce(redirect);
    first.resolve();
    await Promise.all([fromEffect, fromSignIn]);

    expect(calls).toBe(1);
  });

  test("does nothing once a redirect has completed", async () => {
    const redirectOnce = createRedirectOnce();
    let calls = 0;
    const redirect = async () => {
      calls += 1;
    };

    await redirectOnce(redirect);
    await redirectOnce(redirect);

    expect(calls).toBe(1);
  });

  test("a failed redirect reports the error and can be retried", async () => {
    const redirectOnce = createRedirectOnce();
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw new Error("Could not open your Organization");
    };

    await expect(redirectOnce(failing)).rejects.toThrow("Could not open your Organization");
    await redirectOnce(async () => {
      calls += 1;
    });

    expect(calls).toBe(2);
  });
});
