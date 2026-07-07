export const HARDCODED_MAINNET = "multiagency.sputnik-dao.near";
export const HARDCODED_TESTNET = "multiagency.sputnikv2.testnet";

export type Network = "mainnet" | "testnet";

export function pinnedNetwork(): Network | null {
  const v = process.env.NEAR_NETWORK?.toLowerCase();
  return v === "testnet" || v === "mainnet" ? (v as Network) : null;
}

export function defaultOrgAccount(network: Network): string {
  return network === "testnet"
    ? process.env.AGENCY_ORG_ACCOUNT_TESTNET || HARDCODED_TESTNET
    : process.env.AGENCY_ORG_ACCOUNT_MAINNET || HARDCODED_MAINNET;
}

// Derive the base NEAR account for this project (e.g. "multiagentic.near").
// Used as the suffix when resolving a subdomain tenant account.
export function baseTenantSuffix(): string {
  const account = process.env.AGENCY_NEAR_ACCOUNT;
  return account ?? "multiagentic.near";
}

// Returns the Sputnik DAO account ID for the current tenant request.
// Derives tenant from the Host header subdomain, looks up their saved daoAccountId in
// the settings table, and falls back to the env-var / hardcoded default.
export async function getTenantDaoAccountId(
  db: import("../db").Database,
  headers: Headers | undefined,
  network: Network,
): Promise<string> {
  const host = (headers?.get("host") ?? "").replace(/:\d+$/, "");
  const subdomain = host.split(".")[0];
  const suffix = baseTenantSuffix();
  const tenantAccount = subdomain && subdomain !== "localhost" ? `${subdomain}.${suffix}` : null;
  if (tenantAccount) {
    const { eq } = await import("drizzle-orm");
    const { settings } = await import("../db/schema");
    const row = await db.query.settings.findFirst({
      where: eq(settings.orgAccountId, tenantAccount),
      columns: { daoAccountId: true },
    });
    if (row?.daoAccountId) return row.daoAccountId;
  }
  return defaultOrgAccount(network);
}
