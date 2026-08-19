import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";

export type OrgMetadata = {
  daoAccountId?: string;
  type?: "agency" | "client";
  isPersonal?: boolean;
};

export function parseOrgMetadata(raw: unknown): OrgMetadata {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as OrgMetadata;
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") {
    return raw as OrgMetadata;
  }
  return {};
}

// Deployment-level default, set once at plugin initialize from
// bos.config.json (app.api.variables.agencyDaoAccount). Used for
// anonymous requests, which have no organization context.
let defaultDaoAccountId: string | undefined;

export function setDefaultDaoAccountId(id: string | undefined): void {
  defaultDaoAccountId = id;
}

function extractDaoAccountId(context: {
  organization?: {
    organization?: {
      metadata?: unknown;
    } | null;
  } | null;
}): string {
  const metadata = parseOrgMetadata(context.organization?.organization?.metadata);
  const daoAccountId = metadata.daoAccountId;
  if (typeof daoAccountId === "string" && daoAccountId.length > 0) return daoAccountId;
  if (defaultDaoAccountId) return defaultDaoAccountId;
  throw new ORPCError("FORBIDDEN", {
    message:
      metadata.isPersonal || metadata.type === "client"
        ? "This workspace has no DAO. Switch to an agency using the agency menu in the header."
        : "No DAO account configured. A platform admin must create an agency workspace with a Sputnik DAO.",
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
