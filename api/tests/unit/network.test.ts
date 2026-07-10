import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getNetwork } from "../../src/lib/network";

const ENV_KEYS = ["NEAR_NETWORK", "AGENCY_DAO_ACCOUNT"] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const headersWithCookie = (cookie: string | null): Headers => {
  const h = new Headers();
  if (cookie !== null) h.set("cookie", cookie);
  return h;
};

describe("getNetwork — precedence: pinned > current_near_network cookie > mainnet default", () => {
  test("no pin, no cookie → mainnet default", () => {
    expect(getNetwork(new Headers())).toBe("mainnet");
  });

  test("no pin, no headers at all → mainnet default", () => {
    expect(getNetwork(undefined)).toBe("mainnet");
  });

  test("cookie testnet → testnet (free mode)", () => {
    expect(getNetwork(headersWithCookie("current_near_network=testnet"))).toBe("testnet");
  });

  test("cookie mainnet → mainnet (free mode)", () => {
    expect(getNetwork(headersWithCookie("current_near_network=mainnet"))).toBe("mainnet");
  });

  test("cookie parsed when surrounded by other cookies", () => {
    expect(getNetwork(headersWithCookie("foo=bar; current_near_network=testnet; baz=qux"))).toBe(
      "testnet",
    );
  });

  test("unrecognized cookie value falls through to mainnet", () => {
    expect(getNetwork(headersWithCookie("current_near_network=betanet"))).toBe("mainnet");
  });

  test("no current_near_network cookie among others → mainnet default", () => {
    expect(getNetwork(headersWithCookie("foo=bar; baz=qux"))).toBe("mainnet");
  });

  test("`NEAR_NETWORK=testnet` pins testnet regardless of cookie", () => {
    process.env.NEAR_NETWORK = "testnet";
    expect(getNetwork(headersWithCookie("current_near_network=mainnet"))).toBe("testnet");
    expect(getNetwork(headersWithCookie(null))).toBe("testnet");
  });

  test("`NEAR_NETWORK=mainnet` pins mainnet regardless of cookie", () => {
    process.env.NEAR_NETWORK = "mainnet";
    expect(getNetwork(headersWithCookie("current_near_network=testnet"))).toBe("mainnet");
  });

  test("unrecognized `NEAR_NETWORK` value does not pin — cookie still applies", () => {
    process.env.NEAR_NETWORK = "betanet";
    expect(getNetwork(headersWithCookie("current_near_network=testnet"))).toBe("testnet");
    expect(getNetwork(headersWithCookie(null))).toBe("mainnet");
  });
});
