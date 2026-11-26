import { ORPCError } from "@orpc/server";
import type { OrganizationDirectory } from "../lib/organizations";
import { INVITATION_TTL_MS, invitationLink } from "./engagements";
import { appUrl, type EmailSender, escapeHtml } from "./notify";
import type { OrganizationApprovals } from "./organization-approvals";

export type AdminInvite =
  | { status: "invited"; email: string }
  | { status: "failed"; message: string };

export type OrganizationReview =
  | { organizationId: string; decision: "approve"; adminEmail?: string }
  | { organizationId: string; decision: "reject"; reason: string };

export function createOrganizationRequestsService(deps: {
  organizations: OrganizationDirectory;
  approvals: OrganizationApprovals;
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

  async function inviteAdmin(input: {
    organizationId: string;
    email: string;
    inviterId: string;
  }): Promise<AdminInvite> {
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
  }

  return {
    inviteAdmin,

    pending: async () => {
      const organizations = (await deps.organizations.all())
        .map((record) => record.organization)
        .filter((organization) => !organization.isPersonal);
      const approvals = await deps.approvals.of(organizations.map((o) => o.id));
      const waiting = organizations.filter((o) => approvals.get(o.id)?.status === "pending");
      return Promise.all(
        waiting.map(async (organization) => {
          const owner = await deps.organizations.owner(organization.id);
          return {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            requestedBy: owner?.userId ?? null,
            requestedByName: owner?.name ?? null,
            requestedByEmail: owner?.email ?? null,
            requestedByNearAccount: owner?.nearAccountId ?? null,
            requestedAt: (organization.createdAt ?? now()).toISOString(),
          };
        }),
      );
    },

    review: async (review: OrganizationReview, reviewerId: string) => {
      const organization = await deps.organizations.get(review.organizationId);
      if (!organization || organization.isPersonal) {
        throw new ORPCError("NOT_FOUND", { message: "Organization not found" });
      }
      if (review.decision === "reject") {
        await deps.approvals.decide(
          organization.id,
          { status: "rejected", reason: review.reason },
          reviewerId,
        );
        return { id: organization.id, status: "rejected" as const, adminInvite: null };
      }
      await deps.approvals.decide(organization.id, { status: "approved" }, reviewerId);
      const adminInvite = review.adminEmail
        ? await inviteAdmin({
            organizationId: organization.id,
            email: review.adminEmail,
            inviterId: reviewerId,
          })
        : null;
      return { id: organization.id, status: "approved" as const, adminInvite };
    },
  };
}
