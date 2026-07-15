import { describe, expect, test } from "vitest";
import { getTokenMetadata, getTokenMetadataBySymbol } from "../../src/services/tokens";

describe("getTokenMetadataBySymbol — canonical mainnet resolution", () => {
  test("wNEAR resolves to wrap.near, not wrap.testnet", () => {
    expect(getTokenMetadataBySymbol("wNEAR")?.tokenId).toBe("wrap.near");
  });

  test("ETH resolves to eth.bridge.near (Rainbow Bridge), not aurora", () => {
    expect(getTokenMetadataBySymbol("ETH")?.tokenId).toBe("eth.bridge.near");
  });
});

describe("getTokenMetadata — by-id lookup is network-agnostic", () => {
  test("testnet entries remain findable by tokenId", () => {
    expect(getTokenMetadata("wrap.testnet")?.chainNetwork).toBe("testnet");
  });
});

describe("getTokenMetadata — network-aware lookup", () => {
  test("resolves mainnet NEAR, not testnet", () => {
    expect(getTokenMetadata("near", "mainnet")?.name).toBe("NEAR Protocol");
    expect(getTokenMetadata("near", "mainnet")?.chainNetwork).toBe("mainnet");
  });

  test("resolves testnet NEAR when requested", () => {
    expect(getTokenMetadata("near", "testnet")?.name).toBe("NEAR Protocol (testnet)");
    expect(getTokenMetadata("near", "testnet")?.chainNetwork).toBe("testnet");
  });

  test("returns null when no entry matches the network", () => {
    expect(getTokenMetadata("wrap.testnet", "mainnet")).toBeNull();
  });
});
