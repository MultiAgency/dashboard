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

export const PAYOUT_ASSETS = ["wnear", "usdc"] as const;
export type PayoutAsset = (typeof PAYOUT_ASSETS)[number];

export const OWNER_ACTION_KINDS = [
  "rules",
  "grant",
  "grant_revoke",
  "freeze",
  "unfreeze",
  "payout_vote",
] as const;
export type OwnerActionKind = (typeof OWNER_ACTION_KINDS)[number];

export const PAYOUT_VERDICTS = ["approve", "reject"] as const;
export type PayoutVerdict = (typeof PAYOUT_VERDICTS)[number];

export const DEPOSIT_STATES = ["requesting", "ready", "refused", "unknown"] as const;
export type DepositState = (typeof DEPOSIT_STATES)[number];

export const GRANT_DAYS = 90;
export const GRANT_RENEW_DAYS = 14;

export const PAYOUT_ROUTES = ["legacy", "platform"] as const;
export type PayoutRoute = (typeof PAYOUT_ROUTES)[number];
