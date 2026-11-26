import type { Database } from "../../db";
import { agentPayouts, payoutAgents, payoutIntents, platformAgents } from "../../db/schema";

const IN_FLIGHT_INTENT = new Set(["QUEUED", "PROCESSING", "PENDING_APPROVAL"]);

const settled = (payout: { status: string; provenUnsent: boolean }) =>
  payout.status === "paid" ||
  payout.status === "refused" ||
  (payout.status === "failed" && payout.provenUnsent);

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function createOldPayoutPath(deps: {
  db: Database;
  organizationName: (organizationId: string) => Promise<string | null>;
  now?: () => Date;
}) {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();

  return async function oldPayoutPath() {
    const [agents, payouts, intents, platform] = await Promise.all([
      db.select().from(payoutAgents),
      db
        .select({
          organizationId: agentPayouts.organizationId,
          status: agentPayouts.status,
          provenUnsent: agentPayouts.provenUnsent,
        })
        .from(agentPayouts),
      db
        .select({ organizationId: payoutIntents.organizationId, status: payoutIntents.status })
        .from(payoutIntents),
      db
        .select({
          organizationId: platformAgents.organizationId,
          route: platformAgents.payoutRoute,
        })
        .from(platformAgents),
    ]);
    const ids = new Set([...agents, ...payouts, ...intents].map((row) => row.organizationId));
    const organizations = await Promise.all(
      [...ids].map(async (organizationId) => {
        const agent = agents.find((a) => a.organizationId === organizationId) ?? null;
        const route = platform.find((p) => p.organizationId === organizationId)?.route ?? "legacy";
        const unsettled = payouts.filter(
          (p) => p.organizationId === organizationId && !settled(p),
        ).length;
        const inFlight = intents.filter(
          (i) => i.organizationId === organizationId && IN_FLIGHT_INTENT.has(i.status),
        ).length;
        const grantLive =
          agent?.grantExpiresAt && agent.grantExpiresAt.getTime() > now().getTime()
            ? agent.grantExpiresAt
            : null;
        const blockers = [
          ...(unsettled
            ? [
                `${plural(unsettled, "old-path payout isn't", "old-path payouts aren't")} settled (held, processing, unknown or waiting for a check)`,
              ]
            : []),
          ...(inFlight
            ? [
                `${plural(inFlight, "owner action is", "owner actions are")} still in flight on the old path`,
              ]
            : []),
          ...(agent?.agentId && route !== "platform"
            ? [
                "Approved compensation still pays through the old payout agent: connect a platform agent with payouts and switch",
              ]
            : []),
        ];
        return {
          organizationId,
          name: await deps.organizationName(organizationId).catch(() => null),
          route,
          oldAgentId: agent?.agentId ?? null,
          ownerAccountId: agent?.ownerAccountId ?? null,
          unsettledPayouts: unsettled,
          ownerActionsInFlight: inFlight,
          grantLiveUntil: grantLive?.toISOString() ?? null,
          blockers,
        };
      }),
    );
    organizations.sort(
      (a, b) =>
        b.blockers.length - a.blockers.length || a.organizationId.localeCompare(b.organizationId),
    );
    return { drained: organizations.every((o) => o.blockers.length === 0), organizations };
  };
}

export type OldPayoutPath = ReturnType<typeof createOldPayoutPath>;
