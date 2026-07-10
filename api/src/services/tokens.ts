// Display metadata for known FTs; balance discovery via getDaoTokenIds. Unknown → ft_metadata().

// Native chain token sentinel; distinct from any FT contract id.
export const NATIVE_TOKEN_ID = "near";

export interface KnownToken {
  tokenId: string;
  network: string;
  chainNetwork: "mainnet" | "testnet";
  symbol: string;
  decimals: number;
  name: string;
  icon: string | null;
}

const ICON_BASE = "https://s2.coinmarketcap.com/static/img/coins/128x128";

export const KNOWN_TOKENS: KnownToken[] = [
  {
    tokenId: "near",
    network: "near",
    chainNetwork: "mainnet",
    symbol: "NEAR",
    decimals: 24,
    name: "NEAR Protocol",
    icon: `${ICON_BASE}/6535.png`,
  },
  {
    tokenId: "wrap.near",
    network: "near",
    chainNetwork: "mainnet",
    symbol: "wNEAR",
    decimals: 24,
    name: "Wrapped NEAR",
    icon: `${ICON_BASE}/6535.png`,
  },
  {
    tokenId: "usdt.tether-token.near",
    network: "near",
    chainNetwork: "mainnet",
    symbol: "USDT",
    decimals: 6,
    name: "Tether USD",
    icon: `${ICON_BASE}/825.png`,
  },
  {
    tokenId: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    network: "near",
    chainNetwork: "mainnet",
    symbol: "USDC",
    decimals: 6,
    name: "USD Coin",
    icon: `${ICON_BASE}/3408.png`,
  },
  {
    tokenId: "nbtc.bridge.near",
    network: "near",
    chainNetwork: "mainnet",
    symbol: "nBTC",
    decimals: 8,
    name: "Bitcoin (Rainbow Bridge)",
    icon: `${ICON_BASE}/1.png`,
  },
  {
    tokenId: "eth.bridge.near",
    network: "near",
    chainNetwork: "mainnet",
    symbol: "ETH",
    decimals: 18,
    name: "Ether (Rainbow Bridge)",
    icon: `${ICON_BASE}/1027.png`,
  },
  {
    tokenId: "aurora",
    network: "near",
    chainNetwork: "mainnet",
    symbol: "ETH",
    decimals: 18,
    name: "Ether (Aurora)",
    icon: `${ICON_BASE}/1027.png`,
  },
  {
    tokenId: "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near",
    network: "near",
    chainNetwork: "mainnet",
    symbol: "AURORA",
    decimals: 18,
    name: "Aurora",
    icon: `${ICON_BASE}/14803.png`,
  },
  {
    tokenId: "token.sweat",
    network: "near",
    chainNetwork: "mainnet",
    symbol: "SWEAT",
    decimals: 18,
    name: "Sweat Economy",
    icon: `${ICON_BASE}/21351.png`,
  },
  {
    tokenId: "d9c2d319cd7e6177336b0a9c93c21cb48d84fb54.factory.bridge.near",
    network: "near",
    chainNetwork: "mainnet",
    symbol: "HAPI",
    decimals: 18,
    name: "HAPI Protocol",
    icon: `${ICON_BASE}/8567.png`,
  },
  {
    tokenId: "cfi.consumer-fi.near",
    network: "near",
    chainNetwork: "mainnet",
    symbol: "CFI",
    decimals: 18,
    name: "ConsumerFi Protocol",
    icon: `${ICON_BASE}/39057.png`,
  },
  {
    tokenId: "token.publicailab.near",
    network: "near",
    chainNetwork: "mainnet",
    symbol: "PUBLIC",
    decimals: 18,
    name: "PublicAI",
    icon: `${ICON_BASE}/37728.png`,
  },
  {
    tokenId: "token.rhealab.near",
    network: "near",
    chainNetwork: "mainnet",
    symbol: "RHEA",
    decimals: 18,
    name: "Rhea",
    icon: `${ICON_BASE}/37529.png`,
  },
  {
    tokenId: "near",
    network: "near",
    chainNetwork: "testnet",
    symbol: "NEAR",
    decimals: 24,
    name: "NEAR Protocol (testnet)",
    icon: `${ICON_BASE}/6535.png`,
  },
  {
    tokenId: "wrap.testnet",
    network: "near",
    chainNetwork: "testnet",
    symbol: "wNEAR",
    decimals: 24,
    name: "Wrapped NEAR (testnet)",
    icon: `${ICON_BASE}/6535.png`,
  },
];

const REGISTRY_BY_ID = new Map(KNOWN_TOKENS.map((t) => [t.tokenId, t]));

// Per-network symbol registries; first-wins on symbol collision — order canonical entries first.
const REGISTRY_BY_SYMBOL: Record<"mainnet" | "testnet", Map<string, KnownToken>> = {
  mainnet: new Map(),
  testnet: new Map(),
};
for (const t of KNOWN_TOKENS) {
  const map = REGISTRY_BY_SYMBOL[t.chainNetwork];
  if (!map.has(t.symbol)) map.set(t.symbol, t);
}

export function getTokenMetadata(tokenId: string): KnownToken | null {
  return REGISTRY_BY_ID.get(tokenId) ?? null;
}

export function getTokenMetadataBySymbol(
  symbol: string,
  network: "mainnet" | "testnet" = "mainnet",
): KnownToken | null {
  return REGISTRY_BY_SYMBOL[network].get(symbol) ?? null;
}

export function displayToBaseUnits(decimalString: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(decimalString)) {
    throw new Error(`displayToBaseUnits: not a non-negative decimal: ${decimalString}`);
  }
  const [intPart, fracPart = ""] = decimalString.split(".");
  const paddedFrac = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(intPart + paddedFrac);
}

import { Effect } from "every-plugin/effect";
import { getDaoTokenIds, getFtMetadata, getStorageBalance, networkOf } from "./sputnik";
import { getDaoAccountId } from "../lib/org";
import type { Database } from "../db";

export function createTokensService(db: Database) {
  return {
    list: (context: Record<string, unknown>) =>
      Effect.gen(function* () {
        const orgAccountId = yield* getDaoAccountId(context);
        const orgNetwork = networkOf(orgAccountId);
        const ids = yield* Effect.promise(() => getDaoTokenIds(orgAccountId));
        const resolved = yield* Effect.promise(() =>
          Promise.all(
            ids.map(async (id) => {
              if (id === NATIVE_TOKEN_ID) {
                const native = getTokenMetadata(id);
                return native
                  ? { ...native, chainNetwork: orgNetwork }
                  : null;
              }
              const known = getTokenMetadata(id);
              if (known && known.chainNetwork === orgNetwork) return known;
              const ft = await getFtMetadata(id, orgAccountId);
              if (!ft) return null;
              return {
                tokenId: id,
                network: "near",
                chainNetwork: orgNetwork,
                symbol: ft.symbol,
                decimals: ft.decimals,
                name: ft.name,
                icon: ft.icon,
              };
            }),
          ),
        );
        return {
          tokens: resolved.filter(
            (t): t is KnownToken & { chainNetwork: "mainnet" | "testnet" } =>
              t !== null,
          ),
        };
      }),

    getStorageStatus: (
      context: Record<string, unknown>,
      input: { tokenId: string },
    ) =>
      Effect.gen(function* () {
        const orgAccountId = yield* getDaoAccountId(context);
        if (input.tokenId === NATIVE_TOKEN_ID) {
          return { tokenId: input.tokenId, status: null };
        }
        const status = yield* Effect.promise(() =>
          getStorageBalance(orgAccountId, input.tokenId),
        );
        return { tokenId: input.tokenId, status };
      }),
  };
}

export type TokensService = ReturnType<typeof createTokensService>;
