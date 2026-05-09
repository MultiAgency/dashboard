import type { ClientRuntimeConfig } from "@/app";
import { getAuthClient, type SessionData } from "@/app";

export type { Organization } from "@/app";

export const sessionQueryKey = ["session"] as const;

export const sessionQueryOptions = (
  initialSession?: SessionData | null,
  runtimeConfig?: Partial<ClientRuntimeConfig>,
) => ({
  queryKey: sessionQueryKey,
  queryFn: async () => {
    const { data: session } = await getAuthClient(runtimeConfig).getSession();
    return session ?? null;
  },
  staleTime: 60 * 1000,
  gcTime: 10 * 60 * 1000,
  initialData: initialSession,
});

export const organizationsQueryKey = ["organizations"] as const;

export const organizationsQueryOptions = (runtimeConfig?: Partial<ClientRuntimeConfig>) => ({
  queryKey: organizationsQueryKey,
  queryFn: async () => {
    const { data } = await getAuthClient(runtimeConfig).organization.list();
    return (data || []) as Array<{
      id: string;
      name: string;
      slug: string;
      logo?: string | null;
      metadata?: Record<string, unknown>;
      createdAt: Date;
    }>;
  },
  staleTime: 30 * 1000,
});

export const passkeysQueryKey = ["passkeys"] as const;

export const passkeysQueryOptions = (runtimeConfig?: Partial<ClientRuntimeConfig>) => ({
  queryKey: passkeysQueryKey,
  queryFn: async () => {
    const { data } = await getAuthClient(runtimeConfig).passkey.listUserPasskeys();
    return (data || []) as Array<{ id: string; name?: string; createdAt?: Date }>;
  },
  staleTime: 30 * 1000,
});

export async function signOut(runtimeConfig?: Partial<ClientRuntimeConfig>) {
  await getAuthClient(runtimeConfig).signOut();
  await getAuthClient(runtimeConfig)
    .near.disconnect()
    .catch(() => {});
}

export async function createOrganization(
  name: string,
  slug: string,
  runtimeConfig?: Partial<ClientRuntimeConfig>,
) {
  const { data, error } = await getAuthClient(runtimeConfig).organization.create({ name, slug });
  if (error) throw new Error(error.message || "Failed to create organization");
  return data;
}

export async function setActiveOrganization(
  organizationId: string,
  runtimeConfig?: Partial<ClientRuntimeConfig>,
) {
  const { error } = await getAuthClient(runtimeConfig).organization.setActive({ organizationId });
  if (error) throw new Error(error.message || "Failed to switch organization");
}

export async function inviteMember(
  organizationId: string,
  email: string,
  role: string,
  runtimeConfig?: Partial<ClientRuntimeConfig>,
) {
  const { data, error } = await getAuthClient(runtimeConfig).organization.inviteMember({
    organizationId,
    email,
    role,
  });
  if (error) throw new Error(error.message || "Failed to invite member");
  return data;
}

export async function addPasskey(runtimeConfig?: Partial<ClientRuntimeConfig>) {
  const { data, error } = await getAuthClient(runtimeConfig).passkey.addPasskey();
  if (error) throw new Error(error.message || "Failed to add passkey");
  return data;
}

export async function removePasskey(id: string, runtimeConfig?: Partial<ClientRuntimeConfig>) {
  const { error } = await getAuthClient(runtimeConfig).passkey.deletePasskey({ id });
  if (error) throw new Error(error.message || "Failed to remove passkey");
}

export async function linkNearWallet(runtimeConfig?: Partial<ClientRuntimeConfig>) {
  const { data, error } = await getAuthClient(runtimeConfig).near.linkAccount();
  if (error) throw new Error(error.message || "Failed to link NEAR wallet");
  return data;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  runtimeConfig?: Partial<ClientRuntimeConfig>,
) {
  const { error } = await getAuthClient(runtimeConfig).changePassword({
    currentPassword,
    newPassword,
    revokeOtherSessions: false,
  });
  if (error) throw new Error(error.message || "Failed to change password");
}

export async function revokeOtherSessions(runtimeConfig?: Partial<ClientRuntimeConfig>) {
  const { error } = await getAuthClient(runtimeConfig).session.revoke({});
  if (error) throw new Error(error.message || "Failed to revoke sessions");
}

export async function updateProfile(name: string, runtimeConfig?: Partial<ClientRuntimeConfig>) {
  const { error } = await getAuthClient(runtimeConfig).updateUser({ name });
  if (error) throw new Error(error.message || "Failed to update profile");
}

export function isPersonalOrganization(org: { slug: string }, userId: string) {
  return org.slug === userId;
}

export function getActiveOrganization(
  organizations: Array<{ id: string; name: string; slug: string; logo?: string | null }>,
  activeOrgId?: string | null,
) {
  return organizations.find((o) => o.id === activeOrgId);
}
