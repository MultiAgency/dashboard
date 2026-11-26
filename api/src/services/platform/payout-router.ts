import type { WorkOrderDeps } from "../work-orders/service";
import { badRequest } from "./agents";
import type { PlatformPayouts } from "./payouts";

type Payouts = NonNullable<WorkOrderDeps["payouts"]>;

const NO_AGENT = { ready: false, code: "no_agent", reason: "No payout agent" };

export function routePayouts(legacy: Payouts | null, platform: PlatformPayouts): Payouts {
  const pick = async (organizationId: string) =>
    (await platform.routeOf(organizationId)) === "platform" ? platform : legacy;

  return {
    readiness: async (organizationId, payee, amountAtomic, priceUsd) => {
      const payouts = await pick(organizationId);
      return payouts ? payouts.readiness(organizationId, payee, amountAtomic, priceUsd) : NO_AGENT;
    },
    fundingCheck: async (organizationId, needs) =>
      (await (await pick(organizationId))?.fundingCheck?.(organizationId, needs)) ?? null,
    send: async (organizationId, input) => {
      const payouts = await pick(organizationId);
      if (!payouts) throw badRequest("Automatic payouts aren't set up for this Organization");
      return payouts.send(organizationId, input);
    },
    refresh: async (payout) =>
      (await platform.isPlatformPayout(payout.id))
        ? platform.refresh(payout)
        : legacy
          ? legacy.refresh(payout)
          : payout,
    latest: async (requestId) =>
      (await platform.owns(requestId))
        ? platform.latest(requestId)
        : ((await legacy?.latest(requestId)) ?? null),
    ensurePayees: async (organizationId) =>
      (await (await pick(organizationId))?.ensurePayees?.(organizationId)) ?? {
        ok: true,
        reason: null,
      },
    maintain: legacy?.maintain,
  };
}
