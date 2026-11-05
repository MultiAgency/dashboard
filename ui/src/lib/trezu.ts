export function trezuProposalUrl(orgAccountId: string, proposalId: string): string {
  return `https://trezu.app/${orgAccountId}/requests/${proposalId}`;
}

export function trezuTreasuryUrl(orgAccountId: string): string {
  return `https://trezu.app/${orgAccountId}`;
}

export function trezuPaymentUrl(
  orgAccountId: string,
  options: {
    receiverAddress?: string;
    token?: { tokenId: string; symbol: string; network: string; decimals: number };
  },
): string {
  const url = new URL(`https://trezu.app/${orgAccountId}/payments`);
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

export function readableDescription(description: string): string {
  return description
    .split(/\s*<br\s*\/?>\s*/i)
    .map((line) => line.replace(/^\*\s+/, ""))
    .join("\n");
}
