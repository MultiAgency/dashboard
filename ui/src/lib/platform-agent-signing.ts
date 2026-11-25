import type { AuthClient } from "@/lib/auth";
import { signAgentIntent } from "@/lib/payout-agent-signing";

export type PlatformText = { message: string; recipient: string; nonce: string };

const SIGNABLE = new Set(["multiagency.app-setup", "multiagency.app-consent"]);

export function platformTextFields(message: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(message);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const fields = parsed as Record<string, unknown>;
    return typeof fields.type === "string" && SIGNABLE.has(fields.type) ? fields : null;
  } catch {
    return null;
  }
}

export async function signPlatformText(
  authClient: AuthClient,
  ownerAccountId: string,
  text: PlatformText,
): Promise<{ publicKey: string; signature: string }> {
  if (!platformTextFields(text.message)) {
    throw new Error("The dashboard only asks your wallet to sign a platform setup or consent");
  }
  const signed = await signAgentIntent(
    authClient,
    { standard: "nep413", payload: text },
    ownerAccountId,
  );
  if (typeof signed.public_key !== "string" || typeof signed.signature !== "string") {
    throw new Error("The wallet returned no signature");
  }
  return { publicKey: signed.public_key, signature: signed.signature };
}
