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

export function isAgencyWorkspace(metadata: unknown): boolean {
  const meta = parseOrgMetadata(metadata);
  return !meta.isPersonal && meta.type !== "client";
}
