export type InvitationState =
  | "signed-out"
  | "verify-email"
  | "wrong-email"
  | "pending"
  | "unavailable";

type InvitationLike = { status: string; expiresAt: Date | string };

type InvitationError = { status?: number; code?: string; message?: string };

function isExpired(invitation: InvitationLike, now: Date): boolean {
  const expires = new Date(invitation.expiresAt).getTime();
  return !Number.isNaN(expires) && expires <= now.getTime();
}

export function classifyInvitation(input: {
  signedIn: boolean;
  invitation?: unknown;
  error?: InvitationError | null;
}): InvitationState {
  if (!input.signedIn || input.error?.status === 401) return "signed-out";
  if (input.error) {
    if (input.error.code === "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION") return "wrong-email";
    if (input.error.code?.startsWith("EMAIL_VERIFICATION_REQUIRED")) return "verify-email";
    return "unavailable";
  }
  return input.invitation ? "pending" : "unavailable";
}

export function pendingInvitations<T extends InvitationLike>(invitations: T[], now: Date): T[] {
  return invitations.filter((i) => i.status === "pending" && !isExpired(i, now));
}
