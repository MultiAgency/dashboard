export function proposalIdOf(outcome: unknown): string | null {
  const status = (outcome as { status?: { SuccessValue?: unknown } } | null)?.status;
  if (typeof status?.SuccessValue !== "string" || !status.SuccessValue) return null;
  try {
    const value = JSON.parse(atob(status.SuccessValue));
    return Number.isInteger(value) && value >= 0 ? String(value) : null;
  } catch {
    return null;
  }
}
