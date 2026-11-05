import { describe, expect, test, vi } from "vitest";
import type { AuthClient } from "../src/lib/auth";
import { ownerWalletKey, signAgentIntent } from "../src/lib/payout-agent-signing";

function wallet(state: { accountId: string | null; publicKey: string | null } | null) {
  const ensureConnected = vi.fn(async () => true);
  const authClient = {
    near: {
      ensureConnected,
      getState: () => (state ? { ...state, networkId: "mainnet" } : null),
    },
  } as unknown as AuthClient;
  return { authClient, ensureConnected };
}

describe("payout agent owner wallet", () => {
  test("gives the key the connected owner's wallet signs with", async () => {
    const { authClient, ensureConnected } = wallet({
      accountId: "rita.near",
      publicKey: "ed25519:owner",
    });
    await expect(ownerWalletKey(authClient, "rita.near")).resolves.toBe("ed25519:owner");
    expect(ensureConnected).toHaveBeenCalledOnce();
  });

  test("refuses a wallet connected as another account, before anything is prepared or signed", async () => {
    const { authClient } = wallet({ accountId: "mallory.near", publicKey: "ed25519:other" });
    await expect(ownerWalletKey(authClient, "rita.near")).rejects.toThrow(
      "You're connected as mallory.near",
    );
    await expect(
      signAgentIntent(authClient, { standard: "nep413", payload: {} }, "rita.near"),
    ).rejects.toThrow("Connect rita.near, the payout agent's owner");
  });

  test("names nobody when no wallet is connected", async () => {
    const { authClient } = wallet(null);
    await expect(ownerWalletKey(authClient, "rita.near")).rejects.toThrow(
      "You're connected as nobody",
    );
  });
});
