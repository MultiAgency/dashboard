// Symbol + decimals registry for display formatting. Must stay in sync with
// `api/src/services/tokens.ts` `KNOWN_TOKENS`. Source of both is Trezu's
// `nt-be/data/tokens.json` (NEAR-native NEP-141s, originChainName == "near").
const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  near: { symbol: "NEAR", decimals: 24 },
  "wrap.near": { symbol: "wNEAR", decimals: 24 },
  "usdt.tether-token.near": { symbol: "USDT", decimals: 6 },
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": {
    symbol: "USDC",
    decimals: 6,
  },
  "nbtc.bridge.near": { symbol: "nBTC", decimals: 8 },
  "eth.bridge.near": { symbol: "ETH", decimals: 18 },
  aurora: { symbol: "ETH", decimals: 18 },
  "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near": {
    symbol: "AURORA",
    decimals: 18,
  },
  "token.sweat": { symbol: "SWEAT", decimals: 18 },
  "d9c2d319cd7e6177336b0a9c93c21cb48d84fb54.factory.bridge.near": {
    symbol: "HAPI",
    decimals: 18,
  },
  "cfi.consumer-fi.near": { symbol: "CFI", decimals: 18 },
  "token.publicailab.near": { symbol: "PUBLIC", decimals: 18 },
  "token.rhealab.near": { symbol: "RHEA", decimals: 18 },
};

const withThousandsSeparator = (digits: string): string =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function formatTokenAmount(amount: string, tokenId: string): string {
  const known = KNOWN_TOKENS[tokenId];
  if (!known) return `${amount} ${tokenId}`;

  try {
    const n = BigInt(amount);
    const negative = n < 0n;
    const absVal = negative ? -n : n;
    const factor = 10n ** BigInt(known.decimals);
    const wholePart = absVal / factor;
    const fracPart = absVal % factor;
    const fracStr = fracPart
      .toString()
      .padStart(known.decimals, "0")
      .slice(0, 6)
      .replace(/0+$/, "");
    const sign = negative ? "-" : "";
    const wholeFormatted = withThousandsSeparator(wholePart.toString());
    return fracStr.length > 0
      ? `${sign}${wholeFormatted}.${fracStr} ${known.symbol}`
      : `${sign}${wholeFormatted} ${known.symbol}`;
  } catch {
    return `${amount} ${tokenId}`;
  }
}

export function parseDecimalToBase(decimal: string, decimals: number): string {
  const trimmed = decimal.trim();
  if (trimmed === "") throw new Error("Empty amount");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Amount must be a non-negative decimal (e.g. 1.5)");
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) {
    throw new Error(`Too many fractional digits (max ${decimals} for this token)`);
  }
  const padded = frac.padEnd(decimals, "0");
  const result = `${whole}${padded}`.replace(/^0+(?=\d)/, "");
  return result === "" ? "0" : result;
}
