export const NO_AGENCY_DAO = "NO_AGENCY_DAO";

export function needsTreasury(error: unknown): boolean {
  const data = (error as { data?: { reason?: unknown } } | null)?.data;
  return data?.reason === NO_AGENCY_DAO;
}

export function isDefaultOrganizationStaff(
  canAccessAdmin: boolean,
  agencyDao: string | null,
  defaultAgencyDao: string | null,
): boolean {
  return canAccessAdmin && agencyDao !== null && agencyDao === defaultAgencyDao;
}
