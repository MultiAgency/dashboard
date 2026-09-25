export type Caller = {
  userIds: string[];
  platformAdmin: boolean;
  trusted: boolean;
  agency: { organizationId: string; role: string } | null;
};

export type CallerContext = {
  userId?: string | null;
  trusted?: boolean;
  user?: { role?: string | null } | null;
  near?: { primaryAccountId?: string | null } | null;
  organization?: {
    activeOrganizationId?: string | null;
    organization?: { id?: string | null; metadata?: unknown } | null;
    member?: { role?: string | null } | null;
  } | null;
};

const MANAGER_ROLES = ["owner", "admin"];

function isPersonal(metadata: unknown): boolean {
  if (typeof metadata === "string") {
    try {
      return isPersonal(JSON.parse(metadata));
    } catch {
      return false;
    }
  }
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as { isPersonal?: unknown }).isPersonal === true
  );
}

function agencyOf(context: CallerContext): Caller["agency"] {
  const active = context.organization;
  const organizationId = active?.activeOrganizationId ?? active?.organization?.id;
  const role = active?.member?.role;
  if (!context.userId || !organizationId || !role || !active?.organization) return null;
  if (isPersonal(active.organization.metadata)) return null;
  return { organizationId, role };
}

export function callerOf(context: CallerContext): Caller {
  const ids = [context.near?.primaryAccountId, context.userId].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  return {
    userIds: [...new Set(ids)],
    platformAdmin: Boolean(context.userId) && context.user?.role === "admin",
    trusted: context.trusted === true,
    agency: agencyOf(context),
  };
}

type OwnedRecord = { ownerId: string; organizationId: string | null };

function isProjectOwner(caller: Caller, project: OwnedRecord): boolean {
  return caller.userIds.includes(project.ownerId);
}

export function isMemberOf(caller: Caller, organizationId: string | null): boolean {
  return organizationId !== null && caller.agency?.organizationId === organizationId;
}

function isManagerOf(caller: Caller, organizationId: string | null): boolean {
  return isMemberOf(caller, organizationId) && MANAGER_ROLES.includes(caller.agency!.role);
}

export function canView(caller: Caller, project: OwnedRecord & { visibility: string }): boolean {
  return (
    project.visibility === "public" ||
    project.visibility === "unlisted" ||
    isProjectOwner(caller, project) ||
    isMemberOf(caller, project.organizationId)
  );
}

export function canManage(caller: Caller, project: OwnedRecord): boolean {
  return (
    caller.platformAdmin ||
    isProjectOwner(caller, project) ||
    isManagerOf(caller, project.organizationId)
  );
}

export function canDelete(caller: Caller, project: OwnedRecord): boolean {
  return caller.platformAdmin || (caller.trusted && canManage(caller, project));
}

export function canPublish(caller: Caller, organizationId: string | null): boolean {
  return caller.platformAdmin || isManagerOf(caller, organizationId);
}
