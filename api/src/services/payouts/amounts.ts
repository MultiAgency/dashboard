import { NATIVE_TOKEN_ID } from "../tokens";

export const NEAR_ASSET = "nep141:wrap.near";
export const NEAR_DECIMALS = 24;

export function tokenOfAsset(assetId: string): string {
  return assetId === NEAR_ASSET ? NATIVE_TOKEN_ID : assetId.replace(/^nep141:/, "");
}

export function atomicToNear(atomic: bigint, digits = 4): string {
  return atomicToDecimal(atomic, NEAR_DECIMALS, digits);
}

export function atomicToDecimal(atomic: bigint, decimals: number, digits = 4): string {
  const unit = 10n ** BigInt(decimals);
  const scale = 10n ** BigInt(digits);
  const scaled = (atomic * scale) / unit;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(digits, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function topUpFor(needed: bigint, balance: bigint): bigint {
  const step = 10n ** BigInt(NEAR_DECIMALS - 2);
  const missing = needed > balance ? needed - balance : 0n;
  return ((missing + step - 1n) / step) * step;
}
