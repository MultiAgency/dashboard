export type Network = "mainnet" | "testnet";

export function pinnedNetwork(): Network | null {
  const v = process.env.NEAR_NETWORK?.toLowerCase();
  return v === "testnet" || v === "mainnet" ? (v as Network) : null;
}

export function getNetwork(reqHeaders: Headers | undefined): Network {
  const pinned = pinnedNetwork();
  if (pinned) return pinned;
  const m = reqHeaders?.get("cookie")?.match(/(?:^|;\s*)current_near_network=(mainnet|testnet)/);
  if (m) return m[1] as Network;
  return "mainnet";
}
