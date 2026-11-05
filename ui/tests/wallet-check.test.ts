import { AccessKeyDoesNotExistError, generateKey, Near } from "near-kit";
import { describe, expect, test, vi } from "vitest";
import type { AuthClient } from "../src/lib/auth";
import {
  checkSignedDelegate,
  checkSignedMessage,
  delegateEvidenceCells,
  evidenceRow,
  isFullAccessKey,
  SAMPLE_DELEGATE,
  sampleConsentText,
  signDelegateCheck,
  signWalletCheck,
} from "../src/lib/wallet-check";

const PAGE_URL = "https://dashboard.example/platform/wallet-check";
const message = sampleConsentText("platform.example", "rita.near", "2026-11-01T00:00:00.000Z");
const params = { message, recipient: "platform.example", nonce: new Uint8Array(32).fill(7) };

function walletClient(signMessage: (...args: unknown[]) => Promise<unknown>) {
  return {
    near: {
      ensureConnected: vi.fn(async () => true),
      getState: () => ({ accountId: "rita.near", publicKey: null, networkId: "mainnet" }),
      getNearClient: () => ({ signMessage }),
    },
  } as unknown as AuthClient;
}

describe("wallet check", () => {
  test("signs the platform's canonical consent text", () => {
    expect(message).toBe(
      '{"type":"multiagency.app-consent","version":1,"host":"platform.example","deployment":"wallet-check","organization":"wallet-check","owner":"rita.near","agent":"payables","agentId":"wallet-check","scopes":["owner","read"],"expiresAt":"2026-11-01T00:00:00.000Z"}',
    );
  });

  test("a signature without a callback URL verifies as one", async () => {
    const signed = generateKey().signNep413Message("rita.near", params);
    await expect(checkSignedMessage(signed, params, PAGE_URL)).resolves.toMatchObject({
      verifiesWithoutCallbackUrl: true,
      verifiesWithPageUrl: false,
      fullAccessKey: null,
    });
  });

  test("a signature over the page URL as callback URL shows as that", async () => {
    const signed = generateKey().signNep413Message("rita.near", {
      ...params,
      callbackUrl: PAGE_URL,
    });
    await expect(checkSignedMessage(signed, params, PAGE_URL)).resolves.toMatchObject({
      verifiesWithoutCallbackUrl: false,
      verifiesWithPageUrl: true,
    });
  });

  test("a signature for another recipient verifies neither way", async () => {
    const signed = generateKey().signNep413Message("rita.near", {
      ...params,
      recipient: "dashboard.example",
    });
    await expect(checkSignedMessage(signed, params, PAGE_URL)).resolves.toMatchObject({
      verifiesWithoutCallbackUrl: false,
      verifiesWithPageUrl: false,
    });
  });

  describe("signing key on chain (view_access_key)", () => {
    const chain = (getAccessKey: (accountId: string, publicKey: string) => Promise<unknown>) =>
      ({ rpc: { getAccessKey: vi.fn(getAccessKey) } }) as unknown as Near;

    test("a full-access key of the account", async () => {
      const near = chain(async () => ({ permission: "FullAccess", nonce: 1 }));
      await expect(isFullAccessKey(near, "rita.near", "ed25519:key")).resolves.toBe(true);
      expect(near.rpc.getAccessKey).toHaveBeenCalledWith("rita.near", "ed25519:key");
    });

    test("a function-call key isn't one", async () => {
      const near = chain(async () => ({
        permission: { FunctionCall: { receiver_id: "social.near", method_names: [] } },
      }));
      await expect(isFullAccessKey(near, "rita.near", "ed25519:key")).resolves.toBe(false);
    });

    test("a key the account doesn't have isn't one, even when the signature verifies", async () => {
      const key = generateKey();
      const signed = key.signNep413Message("rita.near", params);
      const near = chain(async (accountId, publicKey) => {
        throw new AccessKeyDoesNotExistError(accountId, publicKey);
      });
      await expect(checkSignedMessage(signed, params, PAGE_URL, near)).resolves.toMatchObject({
        verifiesWithoutCallbackUrl: true,
        fullAccessKey: false,
      });
    });

    test("an RPC failure is recorded as not checked", async () => {
      const near = chain(async () => {
        throw new Error("fetch failed");
      });
      await expect(isFullAccessKey(near, "rita.near", "ed25519:key")).resolves.toBeNull();
    });
  });

  test("asks the connected account's wallet for a fresh 32-byte nonce and checks what it returns", async () => {
    const key = generateKey();
    const signMessage = vi.fn(async (p: typeof params) => key.signNep413Message("rita.near", p));
    const result = await signWalletCheck(
      walletClient(signMessage as never),
      message,
      "platform.example",
      PAGE_URL,
    );
    const [asked, options] = signMessage.mock.calls[0] as [typeof params, unknown];
    expect(asked.recipient).toBe("platform.example");
    expect(asked.nonce).toHaveLength(32);
    expect(options).toEqual({ signerId: "rita.near" });
    expect(result).toMatchObject({ kind: "signed", verifiesWithoutCallbackUrl: true });
  });

  test("records a wallet that answers without a signature as not signed", async () => {
    const result = await signWalletCheck(
      walletClient(async () => undefined),
      message,
      "platform.example",
      PAGE_URL,
    );
    expect(result).toEqual({
      kind: "not_signed",
      error: "The wallet returned no signature (null)",
    });
  });

  test("records a wallet refusal as not signed with the wallet's error", async () => {
    const result = await signWalletCheck(
      walletClient(async () => {
        throw new Error("NO_KEY_FOUND");
      }),
      message,
      "platform.example",
      PAGE_URL,
    );
    expect(result).toEqual({ kind: "not_signed", error: "NO_KEY_FOUND" });
    expect(
      evidenceRow(
        "2026-10-27",
        "platform.example",
        {
          wallet: "trezu-wallet",
          showedMessage: false,
          showedRecipient: false,
          warnedRecipient: false,
        },
        result,
      ),
    ).toBe(
      "| trezu-wallet | 2026-10-27 | platform.example | no | no | no | not signed: NO_KEY_FOUND | n/a | n/a | n/a | not tried | n/a | n/a | n/a | n/a | n/a | n/a |",
    );
  });

  describe("delegate action (NEP-366)", () => {
    const key = generateKey();
    const signer = new Near({
      network: "mainnet",
      privateKey: key.secretKey,
      defaultSignerId: "rita.near",
    } as never);
    const delegatePayload = async (receiverId: string = SAMPLE_DELEGATE.receiverId) =>
      (
        await signer
          .transaction("rita.near")
          .functionCall(receiverId, SAMPLE_DELEGATE.methodName, SAMPLE_DELEGATE.args, {
            gas: SAMPLE_DELEGATE.gas,
            attachedDeposit: 0n,
          })
          .delegate({ nonce: 1n, maxBlockHeight: 100n })
      ).payload as string;

    test("a signed delegate action for the sample call verifies and matches", async () => {
      await expect(checkSignedDelegate(await delegatePayload(), "rita.near")).resolves.toEqual({
        kind: "signed",
        format: "v1",
        senderId: "rita.near",
        receiverId: SAMPLE_DELEGATE.receiverId,
        methodNames: [SAMPLE_DELEGATE.methodName],
        matchesRequest: true,
        verifies: true,
      });
    });

    test("a delegate action for another receiver shows as differing", async () => {
      await expect(
        checkSignedDelegate(await delegatePayload("someone-else.near"), "rita.near"),
      ).resolves.toMatchObject({ matchesRequest: false, verifies: true });
    });

    test("a tampered signature doesn't verify", async () => {
      const bytes = Uint8Array.from(atob(await delegatePayload()), (c) => c.charCodeAt(0));
      bytes[bytes.length - 1] ^= 0xff;
      const tampered = btoa(String.fromCharCode(...bytes));
      await expect(checkSignedDelegate(tampered, "rita.near")).resolves.toMatchObject({
        verifies: false,
      });
    });

    test("asks the wallet for exactly the sample call and records a refusal as not signed", async () => {
      const buildSignedDelegateAction = vi.fn(
        async (receiverId: string, build: (builder: unknown, receiverId: string) => any) =>
          (
            await build(signer.transaction("rita.near"), receiverId).delegate({
              nonce: 1n,
              maxBlockHeight: 100n,
            })
          ).payload,
      );
      const client = {
        near: {
          ensureConnected: vi.fn(async () => true),
          getState: () => ({ accountId: "rita.near" }),
          buildSignedDelegateAction,
        },
      } as unknown as AuthClient;
      await expect(signDelegateCheck(client)).resolves.toMatchObject({
        kind: "signed",
        matchesRequest: true,
        verifies: true,
      });
      expect(buildSignedDelegateAction.mock.calls[0]?.[0]).toBe(SAMPLE_DELEGATE.receiverId);

      buildSignedDelegateAction.mockRejectedValueOnce(
        new Error("Connected wallet does not support delegate action signing."),
      );
      const refused = await signDelegateCheck(client);
      expect(refused).toEqual({
        kind: "not_signed",
        error: "Connected wallet does not support delegate action signing.",
      });
      expect(
        delegateEvidenceCells(
          { showedReceiver: true, showedMethod: true, showedArgs: false, showedDeposit: true },
          refused,
        ),
      ).toEqual([
        "not signed: Connected wallet does not support delegate action signing.",
        "yes",
        "yes",
        "no",
        "yes",
        "n/a",
        "n/a",
      ]);
    });
  });
});
