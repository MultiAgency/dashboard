import { createHash, createPublicKey, verify } from "node:crypto";
import type { Intent } from "@near-intents-agent-api/sdk";
import { DELEGATE_ACTION_PREFIX, decodeSignedDelegateAction } from "near-kit";

type Nep413Intent = Extract<Intent, { standard: "nep413" }>;
type Nep366Intent = Extract<Intent, { standard: "nep366" }>;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(text: string, length: number) {
  let n = 0n;
  for (const c of text) {
    const digit = B58.indexOf(c);
    if (digit < 0) throw new Error("Not base58");
    n = n * 58n + BigInt(digit);
  }
  const hex = n.toString(16).padStart(length * 2, "0");
  if (hex.length !== length * 2) throw new Error(`Not ${length} bytes`);
  return Buffer.from(hex, "hex");
}

const rawKey = (key: string) => base58(key.replace(/^ed25519:/, ""), 32);

function signatureBytes(signature: string) {
  const bytes = signature.startsWith("ed25519:")
    ? base58(signature.slice("ed25519:".length), 64)
    : Buffer.from(signature, "base64");
  if (bytes.length !== 64) throw new Error("A signature is 64 bytes");
  return bytes;
}

function verifyEd25519(key: string, message: Buffer, signature: Buffer) {
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), rawKey(key)]);
  return verify(
    null,
    message,
    createPublicKey({ key: spki, format: "der", type: "spki" }),
    signature,
  );
}

function nep413Hash(message: string, nonce: Buffer, recipient: string) {
  if (nonce.length !== 32) throw new Error("A NEP-413 nonce is 32 bytes");
  const str = (s: string) => {
    const bytes = Buffer.from(s, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length);
    return Buffer.concat([length, bytes]);
  };
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(2 ** 31 + 413);
  return createHash("sha256")
    .update(Buffer.concat([tag, str(message), nonce, str(recipient), Buffer.from([0])]))
    .digest();
}

function delegateSigningHash(signedDelegate: Uint8Array) {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(DELEGATE_ACTION_PREFIX);
  const action = Buffer.from(signedDelegate).subarray(0, signedDelegate.length - 65);
  return createHash("sha256")
    .update(Buffer.concat([prefix, action]))
    .digest();
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

const sameJson = (a: unknown, b: unknown) => canonical(a) === canonical(b);

function nep413Problem(intent: Nep413Intent, publicKey: string, signed: Record<string, unknown>) {
  if (!sameJson(signed.payload, intent.payload))
    return "the signed message is not the one prepared";
  if (signed.public_key !== publicKey) return "signed with a key that isn't the owner's";
  if (typeof signed.signature !== "string") return "no signature";
  const { message, nonce, recipient } = intent.payload;
  return verifyEd25519(
    publicKey,
    nep413Hash(message, Buffer.from(nonce, "base64"), recipient),
    signatureBytes(signed.signature),
  )
    ? null
    : "the signature doesn't verify";
}

function nep366Problem(
  intent: Nep366Intent,
  owner: { accountId: string; publicKey: string },
  signed: Record<string, unknown>,
) {
  if (typeof signed.signed_delegate !== "string") return "no signed delegate action";
  const bytes = Buffer.from(signed.signed_delegate, "base64");
  const { delegateAction: action, signature } = decodeSignedDelegateAction(bytes).signedDelegate;
  if (action.senderId !== owner.accountId)
    return "the delegate action is not from the owner's account";
  if (
    !("ed25519Key" in action.publicKey) ||
    !Buffer.from(action.publicKey.ed25519Key.data).equals(rawKey(owner.publicKey))
  )
    return "signed with a key that isn't the owner's";
  if (action.receiverId !== intent.payload.receiverId)
    return "the delegate action calls another contract";
  const expected = intent.payload.actions;
  if (action.actions.length !== expected.length) return "the delegate action holds other actions";
  for (const [i, a] of action.actions.entries()) {
    const params = expected[i]?.params;
    if (!params || !("functionCall" in a)) return "the delegate action holds other actions";
    const call = a.functionCall;
    let args: unknown;
    try {
      args = JSON.parse(Buffer.from(call.args).toString("utf8"));
    } catch {
      return "the delegate action's arguments aren't JSON";
    }
    if (
      call.methodName !== params.methodName ||
      !sameJson(args, params.args) ||
      call.gas !== BigInt(params.gas) ||
      call.deposit !== BigInt(params.deposit)
    )
      return "the delegate action is not the one prepared";
  }
  if (!("ed25519Signature" in signature)) return "not an Ed25519 signature";
  return verifyEd25519(
    owner.publicKey,
    delegateSigningHash(bytes),
    Buffer.from(signature.ed25519Signature.data),
  )
    ? null
    : "the signature doesn't verify";
}

export function ownerSignatureProblem(
  intent: Intent,
  owner: { accountId: string; publicKey: string },
  signed: Record<string, unknown> | null,
): string | null {
  if (!signed) return "nothing was signed";
  if (signed.standard !== intent.standard)
    return "signed by another standard than the one prepared";
  try {
    if (intent.standard === "nep413") return nep413Problem(intent, owner.publicKey, signed);
    if (intent.standard === "nep366") return nep366Problem(intent, owner, signed);
  } catch (error) {
    return `the signed data can't be read (${error instanceof Error ? error.message : "unknown"})`;
  }
  return `MultiAgency signs NEAR intents only, not ${intent.standard}`;
}
