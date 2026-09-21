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

export function isOrganization(metadata: unknown): boolean {
  return !parseOrgMetadata(metadata).isPersonal;
}
