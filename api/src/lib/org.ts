import { ORPCError } from "every-plugin/orpc";

export type OrgMetadata = {
  daoAccountId?: string;
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
    message: metadata.isPersonal
      ? "This Organization has no Agency DAO. Switch Organization using the menu in the header."
      : "No Agency DAO configured. A platform admin must create an Organization with a Sputnik DAO.",
  });
}

export function getDaoAccountIdOrThrow(context: Parameters<typeof extractDaoAccountId>[0]): string {
  return extractDaoAccountId(context);
}
