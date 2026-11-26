import { payoutRetryable } from "../payouts/history";
import type { AgentPayoutView, WorkOrderDeps } from "../work-orders/service";
import type { PlatformPayouts } from "./payouts";

type Payouts = NonNullable<WorkOrderDeps["payouts"]>;

const NO_AGENT = { ready: false, code: "no_agent", reason: "No payout agent" };

export function routePayouts(
  oldLatest: (requestId: string) => Promise<AgentPayoutView | null>,
  platform: PlatformPayouts,
): Payouts {
  const latest = async (requestId: string): Promise<AgentPayoutView | null> => {
    const [onPlatform, before] = await Promise.all([
      platform.latest(requestId),
      oldLatest(requestId),
    ]);
    if (!onPlatform || !before) return onPlatform ?? before;
    return onPlatform.createdAt >= before.createdAt ? onPlatform : before;
  };

  return {
    readiness: async (organizationId, payee, amountAtomic) =>
      (await platform.configured(organizationId))
        ? platform.readiness(organizationId, payee, amountAtomic)
        : NO_AGENT,
    fundingCheck: platform.fundingCheck,
    configured: platform.configured,
    payoutToken: platform.payoutToken,
    send: async (organizationId, input) => {
      const last = await latest(input.requestId);
      if (last && !payoutRetryable(last)) return last;
      return platform.send(organizationId, input);
    },
    refresh: async (payout) =>
      (await platform.isPlatformPayout(payout.id)) ? platform.refresh(payout) : payout,
    latest,
    ensurePayees: async (organizationId) =>
      (await platform.configured(organizationId))
        ? platform.ensurePayees(organizationId)
        : { ok: true, reason: null },
  };
}
