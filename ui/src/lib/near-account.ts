const NEAR_ACCOUNT_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/;

export function isValidNearAccountId(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.length <= 64 && NEAR_ACCOUNT_RE.test(trimmed);
}
