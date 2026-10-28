import type { TransactionBuilder } from "near-kit";
import type { AuthClient } from "@/lib/auth";

type Nep413 = {
  standard: "nep413";
  payload: { message: string; recipient: string; nonce: string };
};
type Nep366 = {
  standard: "nep366";
  payload: {
    receiverId: string;
    actions: {
      params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string };
    }[];
  };
};

function base64Bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export async function ownerWalletKey(
  authClient: AuthClient,
  ownerAccountId: string,
): Promise<string | null> {
  await authClient.near.ensureConnected();
  const state = authClient.near.getState();
  const connected = state?.accountId ?? null;
  if (connected !== ownerAccountId) {
    throw new Error(
      `Connect ${ownerAccountId}, the payout agent's owner, to sign. You're connected as ${connected ?? "nobody"}.`,
    );
  }
  return state?.publicKey ?? null;
}

export async function signAgentIntent(
  authClient: AuthClient,
  intent: Record<string, unknown>,
  ownerAccountId: string,
): Promise<Record<string, unknown>> {
  await ownerWalletKey(authClient, ownerAccountId);
  if (intent.standard === "nep413") {
    const { payload } = intent as unknown as Nep413;
    const signed = await authClient.near.getNearClient().signMessage(
      {
        message: payload.message,
        recipient: payload.recipient,
        nonce: base64Bytes(payload.nonce),
      },
      { signerId: ownerAccountId },
    );
    if (signed.accountId !== ownerAccountId) {
      throw new Error(`The wallet signed as ${signed.accountId}, not ${ownerAccountId}`);
    }
    return { ...intent, public_key: signed.publicKey, signature: signed.signature };
  }
  if (intent.standard === "nep366") {
    const { payload } = intent as unknown as Nep366;
    const signedDelegate = await authClient.near.buildSignedDelegateAction(
      payload.receiverId,
      (builder: TransactionBuilder, receiverId: string) =>
        payload.actions.reduce(
          (tx, { params }) =>
            tx.functionCall(receiverId, params.methodName, params.args, {
              gas: params.gas as `${number}`,
              attachedDeposit: BigInt(params.deposit),
            }),
          builder,
        ),
    );
    return { ...intent, signed_delegate: signedDelegate };
  }
  throw new Error(`This wallet can't sign a "${String(intent.standard)}" request`);
}
