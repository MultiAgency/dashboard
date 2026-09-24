import { ORPCError } from "every-plugin/orpc";
import type { OrganizationMembers, PluginContext } from "../lib/organizations";

export function createOrganizationRecovery(deps: { members: OrganizationMembers }) {
  const { members } = deps;

  return {
    assignOwner: async (
      context: PluginContext,
      input: { organizationId: string; userId: string },
    ): Promise<void> => {
      if (!context.userId || context.user?.role !== "admin") {
        throw new ORPCError("FORBIDDEN", { message: "Only platform admins can assign owners" });
      }
      const roster = await members.roster(context, input.organizationId);
      if (!roster) {
        throw new ORPCError("NOT_FOUND", {
          message: "Organization not found",
          data: { resource: "organization", resourceId: input.organizationId },
        });
      }
      if (roster.organization.isPersonal) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Personal Organizations cannot be given another owner",
        });
      }
      if (roster.members.some((m) => m.role === "owner")) {
        throw new ORPCError("BAD_REQUEST", {
          message: "This Organization already has an owner, who can manage its members",
        });
      }
      const existing = roster.members.find((m) => m.userId === input.userId);
      if (existing) {
        await members.setRole(context, {
          organizationId: input.organizationId,
          memberId: existing.memberId,
          role: "owner",
        });
        return;
      }
      await members.addMember(context, {
        organizationId: input.organizationId,
        userId: input.userId,
        role: "owner",
      });
    },
  };
}

export type OrganizationRecovery = ReturnType<typeof createOrganizationRecovery>;
