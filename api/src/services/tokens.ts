export interface KnownToken {
  tokenId: string;
  network: string;
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
    symbol: "NEAR",
    decimals: 24,
    name: "NEAR Protocol",
    icon: `${ICON_BASE}/6535.png`,
  },
  {
    tokenId: "wrap.near",
    network: "near",
    symbol: "wNEAR",
    decimals: 24,
    name: "Wrapped NEAR",
    icon: `${ICON_BASE}/6535.png`,
  },
  {
    tokenId: "usdt.tether-token.near",
    network: "near",
    symbol: "USDT",
    decimals: 6,
    name: "Tether USD",
    icon: `${ICON_BASE}/825.png`,
  },
  {
    tokenId: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    network: "near",
    symbol: "USDC",
    decimals: 6,
    name: "USD Coin",
    icon: `${ICON_BASE}/3408.png`,
  },
  {
    tokenId: "nbtc.bridge.near",
    network: "near",
    symbol: "nBTC",
    decimals: 8,
    name: "Bitcoin (Rainbow Bridge)",
    icon: `${ICON_BASE}/1.png`,
  },
  {
    tokenId: "eth.bridge.near",
    network: "near",
    symbol: "ETH",
    decimals: 18,
    name: "Ether (Rainbow Bridge)",
    icon: `${ICON_BASE}/1027.png`,
  },
  {
    tokenId: "aurora",
    network: "near",
    symbol: "ETH",
    decimals: 18,
    name: "Ether (Aurora)",
    icon: `${ICON_BASE}/1027.png`,
  },
  {
    tokenId: "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near",
    network: "near",
    symbol: "AURORA",
    decimals: 18,
    name: "Aurora",
    icon: `${ICON_BASE}/14803.png`,
  },
  {
    tokenId: "token.sweat",
    network: "near",
    symbol: "SWEAT",
    decimals: 18,
    name: "Sweat Economy",
    icon: `${ICON_BASE}/21351.png`,
  },
  {
    tokenId: "d9c2d319cd7e6177336b0a9c93c21cb48d84fb54.factory.bridge.near",
    network: "near",
    symbol: "HAPI",
    decimals: 18,
    name: "HAPI Protocol",
    icon: `${ICON_BASE}/8567.png`,
  },
  {
    tokenId: "cfi.consumer-fi.near",
    network: "near",
    symbol: "CFI",
    decimals: 18,
    name: "ConsumerFi Protocol",
    icon: `${ICON_BASE}/39057.png`,
  },
  {
    tokenId: "token.publicailab.near",
    network: "near",
    symbol: "PUBLIC",
    decimals: 18,
    name: "PublicAI",
    icon: `${ICON_BASE}/37728.png`,
  },
  {
    tokenId: "token.rhealab.near",
    network: "near",
    symbol: "RHEA",
    decimals: 18,
    name: "Rhea",
    icon: `${ICON_BASE}/37529.png`,
  },
];
