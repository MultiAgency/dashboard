import {
  AccessKeyDoesNotExistError,
  DELEGATE_ACTION_PREFIX,
  decodeSignedDelegateAction,
  decodeSignedDelegateActionV2,
  type Near,
  type SignedMessage,
  type TransactionBuilder,
  verifyNep413Signature,
} from "near-kit";
import type { AuthClient } from "@/lib/auth";

export const WALLET_CHECK_WALLETS = [
  "intear-wallet",
  "mynearwallet",
  "ledger",
  "meteor-wallet",
  "hot-wallet",
  "near-mobile",
  "okx-wallet",
  "nightly-wallet",
  "hana-wallet",
  "near-cli",
  "trezu-wallet",
  "ethereum-wallets",
] as const;

type SignParams = { message: string; recipient: string; nonce: Uint8Array };

export type SignatureCheck = {
  accountId: string;
  publicKey: string;
  verifiesWithoutCallbackUrl: boolean;
  verifiesWithPageUrl: boolean;
  fullAccessKey: boolean | null;
};

export type WalletCheckResult =
  | ({ kind: "signed" } & SignatureCheck)
  | { kind: "not_signed"; error: string };

export type WalletObservation = {
  wallet: string;
  showedMessage: boolean;
  showedRecipient: boolean;
  warnedRecipient: boolean;
};

export const SAMPLE_DELEGATE = {
  receiverId: "multiagency-wallet-check.near",
  methodName: "wallet_check",
  args: { purpose: "wallet check, never relayed" },
  gas: "30000000000000",
} as const;

export type DelegateCheck =
  | {
      kind: "signed";
      format: "v1" | "v2";
      senderId: string;
      receiverId: string;
      methodNames: string[];
      matchesRequest: boolean;
      verifies: boolean | null;
    }
  | { kind: "not_signed"; error: string };

export type DelegateObservation = {
  showedReceiver: boolean;
  showedMethod: boolean;
  showedArgs: boolean;
  showedDeposit: boolean;
};

export function sampleConsentText(host: string, owner: string, expiresAt: string): string {
  return JSON.stringify({
    type: "multiagency.app-consent",
    version: 1,
    host,
    deployment: "wallet-check",
    organization: "wallet-check",
    owner,
    agent: "payables",
    agentId: "wallet-check",
    scopes: ["owner", "read"],
    expiresAt,
  });
}

export function connectedWallet(): string | null {
  try {
    return localStorage.getItem("selected-wallet");
  } catch {
    return null;
  }
}

export async function isFullAccessKey(
  near: Near,
  accountId: string,
  publicKey: string,
): Promise<boolean | null> {
  try {
    return (await near.rpc.getAccessKey(accountId, publicKey)).permission === "FullAccess";
  } catch (error) {
    return error instanceof AccessKeyDoesNotExistError ? false : null;
  }
}

export async function checkSignedMessage(
  signed: SignedMessage,
  params: SignParams,
  pageUrl: string,
  near?: Near,
): Promise<SignatureCheck> {
  const anyAge = { maxAge: Number.POSITIVE_INFINITY };
  const [verifiesWithoutCallbackUrl, verifiesWithPageUrl, fullAccessKey] = await Promise.all([
    verifyNep413Signature(signed, params, anyAge),
    verifyNep413Signature(signed, { ...params, callbackUrl: pageUrl }, anyAge),
    near ? isFullAccessKey(near, signed.accountId, signed.publicKey) : null,
  ]);
  return {
    accountId: signed.accountId,
    publicKey: signed.publicKey,
    verifiesWithoutCallbackUrl,
    verifiesWithPageUrl,
    fullAccessKey,
  };
}

export async function signWalletCheck(
  authClient: AuthClient,
  message: string,
  recipient: string,
  pageUrl: string,
): Promise<WalletCheckResult> {
  await authClient.near.ensureConnected();
  const accountId = authClient.near.getState()?.accountId;
  if (!accountId) throw new Error("Connect a wallet to sign");
  const near = authClient.near.getNearClient();
  const params = { message, recipient, nonce: crypto.getRandomValues(new Uint8Array(32)) };
  let signed: SignedMessage | undefined;
  try {
    signed = await near.signMessage(params, { signerId: accountId });
  } catch (error) {
    return { kind: "not_signed", error: error instanceof Error ? error.message : String(error) };
  }
  if (!signed?.signature || !signed.publicKey) {
    return {
      kind: "not_signed",
      error: `The wallet returned no signature (${JSON.stringify(signed ?? null)})`,
    };
  }
  return { kind: "signed", ...(await checkSignedMessage(signed, params, pageUrl, near)) };
}

function yesNo(value: boolean | null): string {
  if (value === null) return "not checked";
  return value ? "yes" : "no";
}

export function evidenceRow(
  date: string,
  recipient: string,
  observation: WalletObservation,
  result: WalletCheckResult,
  delegate: string[] = delegateEvidenceCells(
    { showedReceiver: false, showedMethod: false, showedArgs: false, showedDeposit: false },
    null,
  ),
): string {
  const seen = [
    observation.wallet,
    date,
    recipient,
    yesNo(observation.showedMessage),
    yesNo(observation.showedRecipient),
    yesNo(observation.warnedRecipient),
  ];
  const checked =
    result.kind === "signed"
      ? [
          `signed as ${result.accountId}`,
          yesNo(result.verifiesWithoutCallbackUrl),
          yesNo(result.verifiesWithPageUrl),
          yesNo(result.fullAccessKey),
        ]
      : [`not signed: ${result.error}`, "n/a", "n/a", "n/a"];
  return `| ${[...seen, ...checked, ...delegate].map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`;
}

type DecodedDelegate = {
  delegateAction: {
    senderId: string;
    receiverId: string;
    actions: Array<{ functionCall?: { methodName: string } }>;
    publicKey: { ed25519Key?: { data: Uint8Array | number[] } };
  };
  signature: { ed25519Signature?: { data: Uint8Array | number[] } };
};

function delegateSigningMessage(payload: string): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  const action = bytes.slice(0, bytes.length - 65);
  const message = new Uint8Array(4 + action.length);
  new DataView(message.buffer).setUint32(0, DELEGATE_ACTION_PREFIX, true);
  message.set(action, 4);
  return message;
}

async function verifiesEd25519(
  publicKey: Uint8Array<ArrayBuffer>,
  message: Uint8Array<ArrayBuffer>,
  signature: Uint8Array<ArrayBuffer>,
) {
  try {
    const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, [
      "verify",
    ]);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", message));
    return await crypto.subtle.verify({ name: "Ed25519" }, key, signature, hash);
  } catch {
    return null;
  }
}

export async function checkSignedDelegate(
  payload: string,
  accountId: string,
): Promise<Extract<DelegateCheck, { kind: "signed" }>> {
  let format: "v1" | "v2" = "v1";
  let signed: DecodedDelegate | null = null;
  try {
    signed = decodeSignedDelegateAction(payload).signedDelegate as unknown as DecodedDelegate;
  } catch {
    format = "v2";
  }
  if (!signed) {
    const versioned = decodeSignedDelegateActionV2(payload).delegateV2 as unknown as {
      delegateAction?: { v2?: DecodedDelegate["delegateAction"] };
    };
    const action = versioned.delegateAction?.v2;
    if (!action) throw new Error("The wallet returned a delegate action this check can't read");
    const methodNames = action.actions.flatMap((a) =>
      a.functionCall ? [a.functionCall.methodName] : [],
    );
    return {
      kind: "signed",
      format,
      senderId: action.senderId,
      receiverId: action.receiverId,
      methodNames,
      matchesRequest: matches(action, accountId, methodNames),
      verifies: null,
    };
  }
  const action = signed.delegateAction;
  const methodNames = action.actions.flatMap((a) =>
    a.functionCall ? [a.functionCall.methodName] : [],
  );
  const publicKey = action.publicKey.ed25519Key?.data;
  const signature = signed.signature.ed25519Signature?.data;
  const verifies =
    publicKey && signature
      ? await verifiesEd25519(
          new Uint8Array(publicKey),
          delegateSigningMessage(payload),
          new Uint8Array(signature),
        )
      : false;
  return {
    kind: "signed",
    format,
    senderId: action.senderId,
    receiverId: action.receiverId,
    methodNames,
    matchesRequest: matches(action, accountId, methodNames),
    verifies,
  };
}

function matches(
  action: { senderId: string; receiverId: string },
  accountId: string,
  methodNames: string[],
): boolean {
  return (
    action.senderId === accountId &&
    action.receiverId === SAMPLE_DELEGATE.receiverId &&
    methodNames.length === 1 &&
    methodNames[0] === SAMPLE_DELEGATE.methodName
  );
}

export async function signDelegateCheck(authClient: AuthClient): Promise<DelegateCheck> {
  await authClient.near.ensureConnected();
  const accountId = authClient.near.getState()?.accountId;
  if (!accountId) throw new Error("Connect a wallet to sign");
  let payload: string;
  try {
    payload = await authClient.near.buildSignedDelegateAction(
      SAMPLE_DELEGATE.receiverId,
      (builder: TransactionBuilder, receiverId: string) =>
        builder.functionCall(receiverId, SAMPLE_DELEGATE.methodName, SAMPLE_DELEGATE.args, {
          gas: SAMPLE_DELEGATE.gas,
          attachedDeposit: 0n,
        }),
    );
  } catch (error) {
    return { kind: "not_signed", error: error instanceof Error ? error.message : String(error) };
  }
  return checkSignedDelegate(payload, accountId);
}

export function delegateEvidenceCells(
  observation: DelegateObservation,
  result: DelegateCheck | null,
): string[] {
  if (!result) return ["not tried", "n/a", "n/a", "n/a", "n/a", "n/a", "n/a"];
  const seen = [
    yesNo(observation.showedReceiver),
    yesNo(observation.showedMethod),
    yesNo(observation.showedArgs),
    yesNo(observation.showedDeposit),
  ];
  if (result.kind === "not_signed") return [`not signed: ${result.error}`, ...seen, "n/a", "n/a"];
  return [
    `signed (${result.format})`,
    ...seen,
    yesNo(result.matchesRequest),
    yesNo(result.verifies),
  ];
}
