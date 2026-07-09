import type { Network } from "./default-org-account";

export const HARDCODED_NAME = "MultiAgency";
export const HARDCODED_HEADLINE = "Open Books · Open Source · Open Doors";
export const HARDCODED_TAGLINE = "The future of work is near…";
export const HARDCODED_CONTACT_EMAIL = "multiagentic@gmail.com";
export const HARDCODED_WEBSITE_URL = "https://multiagency.ai";
export const HARDCODED_DOCS_URL = "https://multiagency.ai/docs";
export const HARDCODED_DESCRIPTION = "Human-led, AI-native agencies for hire.";
export const HARDCODED_NEARN_ACCOUNT = "multiagency";

export const defaultName = (): string => HARDCODED_NAME;
export const defaultHeadline = (): string => HARDCODED_HEADLINE;
export const defaultTagline = (): string => HARDCODED_TAGLINE;
export const defaultContactEmail = (): string =>
  process.env.AGENCY_CONTACT_EMAIL?.trim() || HARDCODED_CONTACT_EMAIL;
// Return `string | null` preserves forward-compat with the nullable contract shape.
export const defaultWebsiteUrl = (): string | null =>
  process.env.AGENCY_WEBSITE_URL?.trim() || HARDCODED_WEBSITE_URL;
export const defaultDocsUrl = (): string | null =>
  process.env.AGENCY_DOCS_URL?.trim() || HARDCODED_DOCS_URL;
export const defaultDescription = (): string | null =>
  process.env.AGENCY_DESCRIPTION?.trim() || HARDCODED_DESCRIPTION;
export const defaultNearnAccountId = (): string | null =>
  process.env.AGENCY_NEARN_ACCOUNT?.trim() || HARDCODED_NEARN_ACCOUNT;

// Trezu's default role names (Sputnik factory uses all/council); override per fork via env.
export const defaultAdminRoleName = (): string => process.env.AGENCY_ADMIN_ROLE || "Admin";
export const defaultApproverRoleName = (): string => process.env.AGENCY_APPROVER_ROLE || "Approver";
export const defaultRequestorRoleName = (): string =>
  process.env.AGENCY_REQUESTOR_ROLE || "Requestor";

export function defaultPublicSettings(_network: Network) {
  return {
    name: defaultName(),
    headline: defaultHeadline(),
    tagline: defaultTagline(),
    description: defaultDescription(),
    contactEmail: defaultContactEmail(),
    nearnAccountId: defaultNearnAccountId(),
    websiteUrl: defaultWebsiteUrl(),
    docsUrl: defaultDocsUrl(),
    orgAccountId: null as string | null,
  };
}
