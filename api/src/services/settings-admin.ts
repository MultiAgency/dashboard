import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { settings as settingsTable } from "../db/schema";

type Network = "mainnet" | "testnet";

const HARDCODED_NAME = "MultiAgency";
const HARDCODED_HEADLINE = "Open Books · Open Source · Open Doors";
const HARDCODED_TAGLINE = "The future of work is near…";
const HARDCODED_CONTACT_EMAIL = "multiagentic@gmail.com";
const HARDCODED_WEBSITE_URL = "https://multiagency.ai";
const HARDCODED_DOCS_URL = "https://multiagency.ai/docs";
const HARDCODED_DESCRIPTION = "Human-led, AI-native agencies for hire.";
const HARDCODED_NEARN_ACCOUNT = "multiagency";

const defaultName = (): string => HARDCODED_NAME;
const defaultHeadline = (): string => HARDCODED_HEADLINE;
const defaultTagline = (): string => HARDCODED_TAGLINE;
export const defaultContactEmail = (): string =>
  process.env.AGENCY_CONTACT_EMAIL?.trim() || HARDCODED_CONTACT_EMAIL;
const defaultWebsiteUrl = (): string | null =>
  process.env.AGENCY_WEBSITE_URL?.trim() || HARDCODED_WEBSITE_URL;
const defaultDocsUrl = (): string | null =>
  process.env.AGENCY_DOCS_URL?.trim() || HARDCODED_DOCS_URL;
const defaultDescription = (): string | null =>
  process.env.AGENCY_DESCRIPTION?.trim() || HARDCODED_DESCRIPTION;
export const defaultNearnAccountId = (): string | null =>
  process.env.AGENCY_NEARN_ACCOUNT?.trim() || HARDCODED_NEARN_ACCOUNT;

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

type EditableSettings = {
  nearnAccountId: string | null;
  websiteUrl: string | null;
  docsUrl: string | null;
  description: string | null;
  contactEmail: string | null;
};

export type SettingsOwner = { organizationId: string | null; agencyDao: string | null };

export async function getSettingsRow(db: Database, owner: SettingsOwner) {
  if (!owner.organizationId) return null;
  const [row] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.orgAccountId, owner.organizationId))
    .limit(1);
  return row ?? null;
}

export async function getResolvedPublicSettings(
  db: Database,
  network: Network,
  defaultOrganization: SettingsOwner,
) {
  const row = await getSettingsRow(db, defaultOrganization);
  const base = defaultPublicSettings(network);
  return {
    ...base,
    orgAccountId: defaultOrganization.agencyDao,
    nearnAccountId: row?.nearnAccountId ?? defaultNearnAccountId(),
    websiteUrl: row?.websiteUrl ?? defaultWebsiteUrl(),
    docsUrl: row?.docsUrl ?? defaultDocsUrl(),
    description: row?.description ?? defaultDescription(),
    contactEmail: row?.contactEmail ?? base.contactEmail,
  };
}

export async function upsertSettings(
  db: Database,
  organizationId: string,
  fields: EditableSettings,
  byAccountId: string,
): Promise<void> {
  const now = new Date();
  await db
    .insert(settingsTable)
    .values({
      orgAccountId: organizationId,
      nearnAccountId: fields.nearnAccountId,
      websiteUrl: fields.websiteUrl,
      docsUrl: fields.docsUrl,
      description: fields.description,
      contactEmail: fields.contactEmail,
      createdBy: byAccountId,
      createdAt: now,
      updatedBy: byAccountId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: settingsTable.orgAccountId,
      // Excludes createdBy/createdAt — those stay from the original insert.
      set: {
        nearnAccountId: fields.nearnAccountId,
        websiteUrl: fields.websiteUrl,
        docsUrl: fields.docsUrl,
        description: fields.description,
        contactEmail: fields.contactEmail,
        updatedBy: byAccountId,
        updatedAt: now,
      },
    });
}

export async function getAdminSettings(db: Database, owner: SettingsOwner, network: Network) {
  const row = await getSettingsRow(db, owner);
  const base = defaultPublicSettings(network);
  return {
    orgAccountId: owner.agencyDao,
    network,
    editable: {
      nearnAccountId: row?.nearnAccountId ?? base.nearnAccountId,
      websiteUrl: row?.websiteUrl ?? base.websiteUrl,
      docsUrl: row?.docsUrl ?? base.docsUrl,
      description: row?.description ?? base.description,
      contactEmail: row?.contactEmail ?? base.contactEmail,
    },
    readOnly: {
      name: base.name,
      headline: base.headline,
      tagline: base.tagline,
    },
    audit: row
      ? {
          createdBy: row.createdBy,
          createdAt: row.createdAt.toISOString(),
          updatedBy: row.updatedBy,
          updatedAt: row.updatedAt.toISOString(),
        }
      : null,
  };
}
