export const ORGANIZATION_ROLES = ["owner", "admin", "member", "contributor"] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

const WALLET_EMAIL_DOMAIN = "@near.email";
const TEMPORARY_EMAIL = /^temp-[0-9a-f]{8}@/i;

export function realEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase().endsWith(WALLET_EMAIL_DOMAIN) || TEMPORARY_EMAIL.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function nearAccountFromEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  if (!trimmed?.endsWith(WALLET_EMAIL_DOMAIN)) return null;
  return `${trimmed.slice(0, -WALLET_EMAIL_DOMAIN.length)}.near`;
}

export function memberDisplayName(member: {
  userId: string;
  name?: string | null;
  email?: string | null;
}): string {
  return (
    member.name?.trim() ||
    realEmail(member.email) ||
    nearAccountFromEmail(member.email) ||
    member.userId
  );
}

type RoleHolder = { id: string; role: string };

function isOwner(member: RoleHolder): boolean {
  return member.role.split(",").some((role) => role.trim() === "owner");
}

export function isLastOwner(members: RoleHolder[], memberId: string): boolean {
  const member = members.find((m) => m.id === memberId);
  if (!member || !isOwner(member)) return false;
  return members.filter(isOwner).length <= 1;
}

export function canChangeRole(
  members: RoleHolder[],
  memberId: string,
  nextRole: OrganizationRole,
): boolean {
  return nextRole === "owner" || !isLastOwner(members, memberId);
}
