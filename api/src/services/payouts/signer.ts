import { Near, type PrivateKey, parseKey } from "near-kit";
import { networkOf, rpcUrlFor } from "../sputnik";

export type OwnerIntent = { standard: string; payload: unknown };

export type OwnerSigner = {
  publicKey: string;
  sign(
    accountId: string,
    signerPublicKey: string | null,
    intent: OwnerIntent,
  ): Promise<Record<string, unknown>>;
};

type Nep413Payload = { message: string; recipient: string; nonce: string };
type Nep366Payload = {
  receiverId: string;
  actions: {
    params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string };
  }[];
};

export function ownerSignerFrom(privateKey: string | null | undefined): OwnerSigner | null {
  if (!privateKey?.trim()) return null;
  try {
    return createOwnerSigner(privateKey);
  } catch (error) {
    console.error(
      "[API] PAYOUTS_OWNER_PRIVATE_KEY isn't an ed25519:<base58> private key; the server won't sign payout rules",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export function createOwnerSigner(privateKey: string): OwnerSigner {
  const key = privateKey.trim() as PrivateKey;
  const keyPair = parseKey(key);
  const publicKey = keyPair.publicKey.toString();

  return {
    publicKey,
    async sign(accountId, signerPublicKey, intent) {
      if (intent.standard === "nep413") {
        if (signerPublicKey && signerPublicKey !== publicKey) {
          throw new Error(
            `The agent's owner key is ${signerPublicKey}, not the server's key ${publicKey}`,
          );
        }
        const payload = intent.payload as Nep413Payload;
        const signed = keyPair.signNep413Message?.(accountId, {
          message: payload.message,
          recipient: payload.recipient,
          nonce: new Uint8Array(Buffer.from(payload.nonce, "base64")),
        });
        if (!signed) throw new Error("This key can't sign NEP-413 messages");
        return { ...intent, public_key: signed.publicKey, signature: signed.signature };
      }
      if (intent.standard === "nep366") {
        const payload = intent.payload as Nep366Payload;
        const near = new Near({
          network: { networkId: networkOf(accountId), rpcUrl: rpcUrlFor(accountId) },
        });
        const builder = payload.actions.reduce(
          (tx, { params }) =>
            tx.functionCall(payload.receiverId, params.methodName, params.args, {
              gas: params.gas as `${number}`,
              attachedDeposit: BigInt(params.deposit),
            }),
          near.transaction(accountId).signWith(key),
        );
        const { payload: signedDelegate } = await builder.delegate({ publicKey });
        return { ...intent, signed_delegate: signedDelegate };
      }
      throw new Error(`The server can't sign a "${intent.standard}" request`);
    },
  };
}
