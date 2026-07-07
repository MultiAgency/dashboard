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
