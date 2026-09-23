import type { AuthClient } from "@/lib/auth";
import { parseOrgMetadata } from "@/lib/org-metadata";

export async function pendingClientHandover(
  authClient: AuthClient,
  organizationId: string,
  currentUserId: string,
): Promise<{ memberId: string } | null> {
  const { data: organization, error: organizationError } =
    await authClient.organization.getFullOrganization({ query: { organizationId } });
  if (organizationError) {
    throw new Error(organizationError.message || "Could not load Client Organization");
  }

  const ownerUserId = parseOrgMetadata(organization?.metadata).handoverOwnerUserId;
  if (!ownerUserId || ownerUserId === currentUserId) return null;

  let offset = 0;
  while (true) {
    const { data, error } = await authClient.organization.listMembers({
      query: { organizationId, limit: 100, offset },
    });
    if (error) throw new Error(error.message || "Could not load Client Organization members");
    const owner = data?.members.find((member) => member.userId === ownerUserId);
    if (owner) return { memberId: owner.id };
    offset += data?.members.length ?? 0;
    if (!data || offset >= data.total || data.members.length === 0) return null;
  }
}

export async function completeClientHandover(
  authClient: AuthClient,
  organizationId: string,
  currentUserId: string,
): Promise<boolean> {
  const pending = await pendingClientHandover(authClient, organizationId, currentUserId);
  if (!pending) return false;
  const { error } = await authClient.organization.removeMember({
    memberIdOrEmail: pending.memberId,
    organizationId,
  });
  if (error) throw new Error(error.message || "Could not complete Client handover");
  return true;
}
