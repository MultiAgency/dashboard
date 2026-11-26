import { payoutRetryable } from "../payouts/service";
import { NATIVE_TOKEN_ID } from "../tokens";
import type { AgentPayoutView, WorkOrderDeps } from "../work-orders/service";
import { badRequest } from "./agents";
import type { PlatformPayouts } from "./payouts";

type Payouts = NonNullable<WorkOrderDeps["payouts"]>;

const NO_AGENT = { ready: false, code: "no_agent", reason: "No payout agent" };

export function routePayouts(legacy: Payouts | null, platform: PlatformPayouts): Payouts {
  const pick = async (organizationId: string) =>
    (await platform.routeOf(organizationId)) === "platform" ? platform : legacy;

  const latest = async (requestId: string): Promise<AgentPayoutView | null> => {
    const [onPlatform, onLegacy] = await Promise.all([
      platform.latest(requestId),
      legacy ? legacy.latest(requestId) : null,
    ]);
    if (!onPlatform || !onLegacy) return onPlatform ?? onLegacy;
    return onPlatform.createdAt >= onLegacy.createdAt ? onPlatform : onLegacy;
  };

  return {
    readiness: async (organizationId, payee, amountAtomic, priceUsd) => {
      const payouts = await pick(organizationId);
      return payouts ? payouts.readiness(organizationId, payee, amountAtomic, priceUsd) : NO_AGENT;
    },
    fundingCheck: async (organizationId, needs) =>
      (await (await pick(organizationId))?.fundingCheck?.(organizationId, needs)) ?? null,
    payoutToken: async (organizationId) =>
      (await platform.routeOf(organizationId)) === "platform"
        ? platform.payoutToken(organizationId)
        : NATIVE_TOKEN_ID,
    send: async (organizationId, input) => {
      const payouts = await pick(organizationId);
      if (!payouts) throw badRequest("Automatic payouts aren't set up for this Organization");
      if (payouts === legacy && input.tokenId !== NATIVE_TOKEN_ID) {
        throw badRequest("The old payout agent pays only in NEAR");
      }
      const last = await latest(input.requestId);
      if (last && !payoutRetryable(last)) return last;
      return payouts.send(organizationId, input);
    },
    refresh: async (payout) =>
      (await platform.isPlatformPayout(payout.id))
        ? platform.refresh(payout)
        : legacy
          ? legacy.refresh(payout)
          : payout,
    latest,
    ensurePayees: async (organizationId) =>
      (await (await pick(organizationId))?.ensurePayees?.(organizationId)) ?? {
        ok: true,
        reason: null,
      },
    maintain: legacy?.maintain,
  };
}
