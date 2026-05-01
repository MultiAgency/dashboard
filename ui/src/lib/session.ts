import { queryOptions, skipToken } from "@tanstack/react-query";
import { authClient } from "./auth-client";

export type SessionData = typeof authClient.$Infer.Session;
export type User = SessionData["user"];
export type SessionInfo = SessionData["session"];

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

// ============================================================================
// Session Query
// ============================================================================

export const sessionQueryOptions = (initialSession?: SessionData | null) =>
  queryOptions({
    queryKey: ["session"],
    queryFn: async () => {
      const { data: session } = await authClient.getSession();
      return session ?? null;
    },
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    initialData: initialSession,
  });

// ============================================================================
// Organizations Queries
// ============================================================================

export const organizationsQueryOptions = (initialOrgs?: Organization[]) =>
  queryOptions({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data } = await authClient.organization.list();
      return (data || []) as Organization[];
    },
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000,
    initialData: initialOrgs,
  });

export const organizationQueryOptions = (orgId: string | undefined) =>
  queryOptions({
    queryKey: ["organizations", orgId],
    queryFn: orgId
      ? async () => {
          const { data } = await authClient.organization.list();
          const org = data?.find((o) => o.id === orgId);
          return org as Organization | null;
        }
      : skipToken,
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: !!orgId,
  });

// ============================================================================
// Passkeys Query
// ============================================================================

export interface Passkey {
  id: string;
  name?: string;
  createdAt?: Date;
}

export const passkeysQueryOptions = () =>
  queryOptions({
    queryKey: ["passkeys"],
    queryFn: async () => {
      const { data } = await authClient.passkey.listUserPasskeys();
      return (data || []) as Passkey[];
    },
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

// ============================================================================
// Auth Helpers
// ============================================================================

export function getSessionFromData(session: SessionData | null | undefined) {
  if (!session?.user) {
    return {
      isAuthenticated: false,
      user: null,
      session: null,
      activeOrganizationId: null,
      isAnonymous: false,
      isAdmin: false,
      isBanned: false,
    };
  }

  return {
    isAuthenticated: true,
    user: session.user,
    session: session.session,
    activeOrganizationId: session.session?.activeOrganizationId || null,
    isAnonymous: session.user.isAnonymous || false,
    isAdmin: session.user.role === "admin",
    isBanned: session.user.banned || false,
  };
}

export function getActiveOrganization(
  organizations: Organization[],
  activeOrgId: string | null | undefined,
) {
  if (!activeOrgId || !organizations.length) return null;
  return organizations.find((org) => org.id === activeOrgId) || null;
}

export function isPersonalOrganization(org: Organization, userId: string) {
  return org.slug === userId || org.metadata?.isPersonal === true;
}

// ============================================================================
// Auth Actions
// ============================================================================

export async function signOut() {
  await authClient.signOut();
  await authClient.near.disconnect().catch(() => {});
}

export async function setActiveOrganization(orgId: string) {
  const { data, error } = await authClient.organization.setActive({
    organizationId: orgId,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function createOrganization(name: string, slug: string) {
  const { data, error } = await authClient.organization.create({
    name,
    slug,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function inviteMember(orgId: string, email: string, role: "admin" | "member") {
  const { data, error } = await authClient.organization.inviteMember({
    organizationId: orgId,
    email,
    role,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function acceptInvitation(invitationId: string) {
  const { data, error } = await authClient.organization.acceptInvitation({
    invitationId,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function addPasskey() {
  const { error } = await authClient.passkey.addPasskey();
  if (error) throw new Error(error.message);
}

export async function removePasskey(passkeyId: string) {
  const { error } = await authClient.passkey.deletePasskey({
    id: passkeyId,
  });
  if (error) throw new Error(error.message);
}

export async function updateProfile(name: string) {
  const { error } = await authClient.updateUser({ name });
  if (error) throw new Error(error.message);
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const { error } = await authClient.changePassword({
    currentPassword,
    newPassword,
  });
  if (error) throw new Error(error.message);
}

export async function revokeOtherSessions() {
  const { error } = await authClient.revokeSessions();
  if (error) throw new Error(error.message);
}

export async function linkNearWallet() {
  await authClient.signIn.near();
}

export async function sendPhoneOtp(phoneNumber: string) {
  const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber });
  if (error) throw new Error(error.message);
}

export async function verifyPhoneOtp(phoneNumber: string, code: string) {
  const { error } = await authClient.phoneNumber.verify({ phoneNumber, code });
  if (error) throw new Error(error.message);
}
