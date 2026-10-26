import { NATIVE_TOKEN_ID } from "../tokens";

const TOKENS_URL = "https://1click.chaindefuser.com/v0/tokens";
const CACHE_MS = 60_000;
const TIMEOUT_MS = 10_000;
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

export const USD = "usd";
export const USD_DECIMALS = 6;

export type PriceQuote = { priceUsd: string; at: string };

export type PriceFeed = { price(tokenId: string): Promise<PriceQuote> };

export function usdToTokens(microUsd: bigint, priceUsd: string, decimals: number): bigint {
  const match = DECIMAL.exec(priceUsd.trim());
  if (!match) throw new Error(`Invalid price ${priceUsd}`);
  const fraction = match[2] ?? "";
  const units = BigInt(`${match[1]}${fraction}`);
  if (units <= 0n) throw new Error("The price must be more than zero");
  return (
    (microUsd * 10n ** BigInt(decimals) * 10n ** BigInt(fraction.length)) /
    (units * 10n ** BigInt(USD_DECIMALS))
  );
}

function priceText(value: number): string {
  if (!Number.isFinite(value) || value <= 0) throw new Error("No price");
  const text = String(value);
  if (!/e/i.test(text)) return text;
  return value.toFixed(18).replace(/0+$/, "").replace(/\.$/, "");
}

export function createPriceFeed(fetcher: typeof fetch = fetch): PriceFeed {
  let cached: { at: number; prices: Map<string, PriceQuote> } | null = null;

  async function load(): Promise<Map<string, PriceQuote>> {
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.prices;
    const response = await fetcher(TOKENS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`The price service answered ${response.status}`);
    const tokens = (await response.json()) as {
      assetId?: string;
      price?: number;
      priceUpdatedAt?: string;
    }[];
    const prices = new Map<string, PriceQuote>();
    for (const token of tokens) {
      if (!token.assetId?.startsWith("nep141:") || typeof token.price !== "number") continue;
      try {
        prices.set(token.assetId.slice("nep141:".length), {
          priceUsd: priceText(token.price),
          at: token.priceUpdatedAt ?? new Date().toISOString(),
        });
      } catch {}
    }
    cached = { at: Date.now(), prices };
    return prices;
  }

  return {
    async price(tokenId) {
      const contract = tokenId === NATIVE_TOKEN_ID ? "wrap.near" : tokenId;
      const quote = (await load()).get(contract);
      if (!quote) throw new Error(`No USD price is available for ${tokenId}`);
      return quote;
    },
  };
}
