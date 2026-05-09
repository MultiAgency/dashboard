// Reference list for a future host/edge IP-based gate; no current consumer.
export const SANCTIONED_COUNTRY_CODES: ReadonlySet<string> = new Set([
  "AF", // Afghanistan
  "BY", // Belarus
  "CF", // Central African Republic
  "CD", // Democratic Republic of Congo
  "CU", // Cuba
  "GW", // Guinea-Bissau
  "HT", // Haiti
  "IR", // Iran
  "KP", // North Korea (DPRK)
  "LY", // Libya
  "ML", // Mali
  "MM", // Myanmar (Burma)
  "NI", // Nicaragua
  "RU", // Russia
  "SD", // Sudan
  "SO", // Somalia
  "SS", // South Sudan
  "SY", // Syria
  "VE", // Venezuela
  "YE", // Yemen
  "ZW", // Zimbabwe
]);

// Sub-national regions sanctioned within an otherwise-allowed country (e.g. Crimea under UA).
export const SANCTIONED_REGIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    "UA",
    new Set([
      "43", // Crimea
      "40", // Sevastopol
      "14", // Donetsk
      "09", // Luhansk
      "23", // Zaporizhzhia
      "65", // Kherson
    ]),
  ],
]);

export function isSanctionedJurisdiction(
  countryCode: string | null | undefined,
  regionCode?: string | null,
): boolean {
  if (!countryCode) return false;
  const cc = countryCode.toUpperCase();
  if (SANCTIONED_COUNTRY_CODES.has(cc)) return true;
  if (regionCode) {
    const regions = SANCTIONED_REGIONS.get(cc);
    if (regions?.has(regionCode)) return true;
  }
  return false;
}
