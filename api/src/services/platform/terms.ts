import { z } from "zod";

export const PLATFORM_AREA = "payables";
export const CONSENT_SCOPES = ["owner", "read"] as const;
export const CONSENT_DAYS = [30, 90, 365] as const;
export type ConsentDays = (typeof CONSENT_DAYS)[number];

export const PLATFORM_SIGNING_KINDS = ["setup", "consent"] as const;
export const PLATFORM_REVOKED_REASONS = [
  "dashboard",
  "access_ended",
  "organization_deleted",
] as const;

export const PLATFORM_AGENT_STATES = [
  "off",
  "not_connected",
  "setup_pending",
  "setup_expired",
  "creating",
  "needs_consent",
  "consent_pending",
  "connected",
  "ended",
] as const;
export type PlatformAgentState = (typeof PLATFORM_AGENT_STATES)[number];

export const nep413Intent = z.object({
  standard: z.literal("nep413"),
  payload: z.object({ message: z.string(), recipient: z.string(), nonce: z.string() }),
});
