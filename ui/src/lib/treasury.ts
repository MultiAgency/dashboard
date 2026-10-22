export const NO_AGENCY_DAO = "NO_AGENCY_DAO";

export function needsTreasury(error: unknown): boolean {
  const data = (error as { data?: { reason?: unknown } } | null)?.data;
  return data?.reason === NO_AGENCY_DAO;
}

export type AgentHeldView =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "empty"; updatedAt: string }
  | { kind: "balances"; balances: { tokenId: string; balance: string }[]; updatedAt: string };

type AgentHeldData =
  | { status: "available"; balances: { tokenId: string; balance: string }[]; updatedAt: string }
  | { status: "unavailable"; reason: "not-configured" | "read-failed" };

const UNAVAILABLE_MESSAGES = {
  "not-configured": "Agent-held balances are not connected for this treasury yet.",
  "read-failed": "Agent-held balances could not be read right now.",
} as const;

/** A failed or missing read is "unavailable", never an empty or zero balance. */
export function agentHeldView(
  data: AgentHeldData | undefined,
  state: { isLoading: boolean; isError: boolean },
): AgentHeldView {
  if (state.isLoading) return { kind: "loading" };
  if (state.isError || !data)
    return { kind: "unavailable", message: UNAVAILABLE_MESSAGES["read-failed"] };
  if (data.status === "unavailable") {
    return { kind: "unavailable", message: UNAVAILABLE_MESSAGES[data.reason] };
  }
  if (data.balances.length === 0) return { kind: "empty", updatedAt: data.updatedAt };
  return { kind: "balances", balances: data.balances, updatedAt: data.updatedAt };
}

export function isDefaultOrganizationStaff(
  canAccessAdmin: boolean,
  agencyDao: string | null,
  defaultAgencyDao: string | null,
): boolean {
  return canAccessAdmin && agencyDao !== null && agencyDao === defaultAgencyDao;
}
