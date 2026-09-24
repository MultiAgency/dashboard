export type RosterMember = { memberId: string; userId: string; role: string };

export type Roster = {
  organization: { id: string; name: string; isPersonal: boolean };
  members: RosterMember[];
};

export type OrganizationMembersStore = {
  findUserId(emailOrId: string): Promise<string | null>;
  roster(organizationId: string): Promise<Roster | null>;
  addOwner(input: { organizationId: string; userId: string }): Promise<void>;
  promoteToOwner(input: { memberId: string }): Promise<void>;
};

export type AssignOwnerResult = {
  organizationId: string;
  organizationName: string;
  userId: string;
  action: "promoted" | "added";
  applied: boolean;
};

export class OwnerRecoveryError extends Error {
  readonly code:
    | "USER_NOT_FOUND"
    | "ORGANIZATION_NOT_FOUND"
    | "PERSONAL_ORGANIZATION"
    | "HAS_OWNER";
  constructor(code: OwnerRecoveryError["code"], message: string) {
    super(message);
    this.name = "OwnerRecoveryError";
    this.code = code;
  }
}

function isOwner(member: RosterMember): boolean {
  return member.role.split(",").some((role) => role.trim() === "owner");
}

export function createOrganizationRecovery(deps: { members: OrganizationMembersStore }) {
  const { members } = deps;

  return {
    assignOwner: async (input: {
      organizationId: string;
      user: string;
      dryRun?: boolean;
    }): Promise<AssignOwnerResult> => {
      const userId = await members.findUserId(input.user);
      if (!userId) {
        throw new OwnerRecoveryError("USER_NOT_FOUND", `No user matches ${input.user}`);
      }
      const roster = await members.roster(input.organizationId);
      if (!roster) {
        throw new OwnerRecoveryError(
          "ORGANIZATION_NOT_FOUND",
          `Organization ${input.organizationId} not found`,
        );
      }
      if (roster.organization.isPersonal) {
        throw new OwnerRecoveryError(
          "PERSONAL_ORGANIZATION",
          "Personal Organizations cannot be given another owner",
        );
      }
      if (roster.members.some(isOwner)) {
        throw new OwnerRecoveryError(
          "HAS_OWNER",
          "This Organization already has an owner, who can manage its members",
        );
      }
      const existing = roster.members.find((m) => m.userId === userId);
      const result: AssignOwnerResult = {
        organizationId: roster.organization.id,
        organizationName: roster.organization.name,
        userId,
        action: existing ? "promoted" : "added",
        applied: !input.dryRun,
      };
      if (input.dryRun) return result;
      if (existing) {
        await members.promoteToOwner({ memberId: existing.memberId });
      } else {
        await members.addOwner({ organizationId: roster.organization.id, userId });
      }
      return result;
    },
  };
}

export type OrganizationRecovery = ReturnType<typeof createOrganizationRecovery>;
