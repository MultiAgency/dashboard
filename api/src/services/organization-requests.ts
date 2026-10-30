import type { OrganizationDirectory } from "../lib/organizations";
import { INVITATION_TTL_MS, invitationLink } from "./engagements";
import { appUrl, type EmailSender, escapeHtml } from "./notify";

export type AdminInvite =
  | { status: "invited"; email: string }
  | { status: "failed"; message: string };

export function createOrganizationRequestsService(deps: {
  organizations: OrganizationDirectory;
  sendEmail: EmailSender | null;
  appOrigin: string;
  now?: () => Date;
}) {
  const now = () => deps.now?.() ?? new Date();

  async function sendInvitation(
    organizationName: string,
    invitation: { id: string; email: string },
  ) {
    const url = appUrl(deps.appOrigin, invitationLink(invitation));
    if (!deps.sendEmail || !url) return;
    try {
      await deps.sendEmail({
        to: invitation.email,
        subject: `You're invited to ${organizationName} on MultiAgency`,
        html: `<p>${escapeHtml(organizationName)} was approved on MultiAgency, and you were invited as its admin.</p><p><a href="${escapeHtml(url)}">Accept the invitation</a></p>`,
      });
    } catch (err) {
      console.warn("[API] invitation email failed:", err instanceof Error ? err.message : err);
    }
  }

  return {
    inviteAdmin: async (input: {
      organizationId: string;
      email: string;
      inviterId: string;
    }): Promise<AdminInvite> => {
      try {
        const organization = await deps.organizations.get(input.organizationId);
        const invitation = await deps.organizations.invite({
          organizationId: input.organizationId,
          email: input.email,
          role: "admin",
          inviterId: input.inviterId,
          expiresAt: new Date(now().getTime() + INVITATION_TTL_MS),
        });
        await sendInvitation(organization?.name ?? input.organizationId, invitation);
        return { status: "invited", email: invitation.email };
      } catch (err) {
        console.warn("[API] admin invitation failed:", err instanceof Error ? err.message : err);
        return {
          status: "failed",
          message: err instanceof Error ? err.message : "Couldn't create the invitation",
        };
      }
    },
  };
}
