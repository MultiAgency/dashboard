import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { settings as settingsTable } from "../db/schema";
import type { Network } from "../lib/default-org-account";
import {
  defaultDescription,
  defaultDocsUrl,
  defaultNearnAccountId,
  defaultPublicSettings,
  defaultWebsiteUrl,
} from "../lib/settings-defaults";

type EditableSettings = {
  daoAccountId?: string | null;
  nearnAccountId: string | null;
  websiteUrl: string | null;
  docsUrl: string | null;
  description: string | null;
  contactEmail: string | null;
};

export async function getSettingsRow(db: Database, orgAccountId: string) {
  const rows = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.orgAccountId, orgAccountId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getResolvedPublicSettings(
  db: Database,
  network: Network,
  orgAccountId: string,
) {
  const row = await getSettingsRow(db, orgAccountId);
  const base = defaultPublicSettings(network);
  return {
    ...base,
    orgAccountId,
    daoAccountId: row?.daoAccountId ?? null,
    nearnAccountId: row?.nearnAccountId ?? defaultNearnAccountId(),
    websiteUrl: row?.websiteUrl ?? defaultWebsiteUrl(),
    docsUrl: row?.docsUrl ?? defaultDocsUrl(),
    description: row?.description ?? defaultDescription(),
    contactEmail: row?.contactEmail ?? base.contactEmail,
  };
}

export async function upsertSettings(
  db: Database,
  orgAccountId: string,
  fields: EditableSettings,
  byAccountId: string,
): Promise<void> {
  const now = new Date();
  await db
    .insert(settingsTable)
    .values({
      orgAccountId,
      daoAccountId: fields.daoAccountId ?? null,
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
        daoAccountId: fields.daoAccountId ?? null,
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
