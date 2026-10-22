export interface AgentHeldBalance {
  tokenId: string;
  balance: string;
}

export interface AgentHeldReading {
  balances: AgentHeldBalance[];
  updatedAt: string;
}

/**
 * Reads what the Treasury agent holds on NEAR Intents for a DAO. Throws when it cannot read.
 * Read-only: nothing here can move funds.
 */
export type AgentHeldSource = (daoAccountId: string) => Promise<AgentHeldReading>;

export type AgentHeldResult =
  | { status: "available"; balances: AgentHeldBalance[]; updatedAt: string }
  | { status: "unavailable"; reason: "not-configured" | "read-failed" };

/** Failure to read is "unavailable", never an empty balance list. */
export async function readAgentHeld(
  source: AgentHeldSource | null,
  daoAccountId: string,
): Promise<AgentHeldResult> {
  if (!source) return { status: "unavailable", reason: "not-configured" };
  try {
    const reading = await source(daoAccountId);
    return { status: "available", balances: reading.balances, updatedAt: reading.updatedAt };
  } catch (err) {
    console.warn("[API] readAgentHeld failed:", (err as Error).message);
    return { status: "unavailable", reason: "read-failed" };
  }
}
