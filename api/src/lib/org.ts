import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";

export type OrgMetadata = { daoAccountId?: string; type?: "agency" | "client" };

function extractDaoAccountId(context: {
  organization?: {
    organization?: {
      metadata?: OrgMetadata | null;
    } | null;
  } | null;
}): string {
  const daoAccountId = context.organization?.organization?.metadata?.daoAccountId;
  if (typeof daoAccountId === "string" && daoAccountId.length > 0) return daoAccountId;
  throw new ORPCError("INTERNAL_SERVER_ERROR", {
    message: "No DAO account configured. A platform admin must create an agency workspace.",
  });
}

export function getDaoAccountId(
  context: Parameters<typeof extractDaoAccountId>[0],
): Effect.Effect<string, ORPCError<string, unknown>> {
  return Effect.try({
    try: () => extractDaoAccountId(context),
    catch: (err) => err as ORPCError<string, unknown>,
  });
}

export function getDaoAccountIdOrThrow(context: Parameters<typeof extractDaoAccountId>[0]): string {
  return extractDaoAccountId(context);
}
