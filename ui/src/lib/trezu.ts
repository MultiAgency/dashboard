export function trezuProposalUrl(daoAccountId: string, proposalId: string): string {
  return `https://trezu.app/${daoAccountId}/requests/${proposalId}`;
}

export function trezuTreasuryUrl(daoAccountId: string): string {
  return `https://trezu.app/${daoAccountId}`;
}

export function trezuPaymentUrl(
  daoAccountId: string,
  options: {
    receiverAddress?: string;
    token?: { tokenId: string; symbol: string; network: string; decimals: number };
  },
): string {
  const url = new URL(`https://trezu.app/${daoAccountId}/payments`);
  if (options.receiverAddress) {
    url.searchParams.set("address", options.receiverAddress);
  }
  if (options.token) {
    url.searchParams.set(
      "token",
      JSON.stringify({
        symbol: options.token.symbol,
        address: options.token.tokenId,
        network: options.token.network,
        decimals: options.token.decimals,
      }),
    );
    url.searchParams.set("networks", options.token.network);
  }
  return url.toString();
}
