import { and, eq } from "drizzle-orm";
import type { Database } from "../db";
import { organizationBuilderLogins } from "../db/schema";

export async function rememberedLogins(
  db: Database,
  organizationId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({
      nearAccount: organizationBuilderLogins.nearAccount,
      githubLogin: organizationBuilderLogins.githubLogin,
    })
    .from(organizationBuilderLogins)
    .where(eq(organizationBuilderLogins.organizationId, organizationId));
  return new Map(rows.map((r) => [r.nearAccount, r.githubLogin]));
}

export async function rememberedLogin(
  db: Database,
  organizationId: string,
  nearAccount: string,
): Promise<string | null> {
  const [row] = await db
    .select({ githubLogin: organizationBuilderLogins.githubLogin })
    .from(organizationBuilderLogins)
    .where(
      and(
        eq(organizationBuilderLogins.organizationId, organizationId),
        eq(organizationBuilderLogins.nearAccount, nearAccount),
      ),
    )
    .limit(1);
  return row?.githubLogin ?? null;
}

export async function rememberLogin(
  db: Database,
  organizationId: string,
  nearAccount: string,
  githubLogin: string,
  at: Date = new Date(),
): Promise<void> {
  await db
    .insert(organizationBuilderLogins)
    .values({ organizationId, nearAccount, githubLogin, updatedAt: at })
    .onConflictDoUpdate({
      target: [organizationBuilderLogins.organizationId, organizationBuilderLogins.nearAccount],
      set: { githubLogin, updatedAt: at },
    });
}
