import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components";
import { type ApiClient, useApiClient } from "@/lib/api";
import { useAuthClient } from "@/lib/auth";
import { signAgentIntent } from "@/lib/payout-agent-signing";
import { payoutAgentQueryKey, payoutAgentQueryOptions } from "@/lib/queries";

type PayoutAgent = Awaited<ReturnType<ApiClient["workOrders"]["payoutAgent"]>>;

export type SyncPayoutRulesResult = { ok: boolean };

export function useSyncPayoutRules() {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();

  const setData = (data: PayoutAgent) =>
    queryClient.setQueryData(payoutAgentQueryOptions(apiClient).queryKey, data);

  return useMutation({
    mutationFn: async (): Promise<SyncPayoutRulesResult> => {
      const attempt = await apiClient.workOrders.allowPayees({});
      setData(attempt.view);
      if (attempt.ok) return { ok: true };
      if (!attempt.needsSignature) throw new Error(attempt.reason ?? "Couldn't update the rules");
      const owner = attempt.view.settings?.ownerAccountId;
      if (!owner) throw new Error("Save the payout settings first");
      const prepared = await apiClient.workOrders.preparePayoutAction({ action: "sync_policy" });
      const signedData = await signAgentIntent(authClient, prepared.intent, owner);
      const result = await apiClient.workOrders.submitPayoutAction({
        correlationId: prepared.correlationId,
        signedData,
      });
      setData(result.view);
      return { ok: result.status === "SUCCESS" };
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: payoutAgentQueryKey }),
  });
}

export type AllowPayeesButtonProps = {
  payee?: string;
  label?: string;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "secondary";
  className?: string;
  onDone?: (result: SyncPayoutRulesResult) => void;
};

export function AllowPayeesButton({
  payee,
  label,
  size = "sm",
  variant = "default",
  className,
  onDone,
}: AllowPayeesButtonProps) {
  const sync = useSyncPayoutRules();
  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      disabled={sync.isPending}
      onClick={() =>
        sync.mutate(undefined, {
          onSuccess: (result) => {
            if (result.ok) {
              toast.success(
                payee ? `Payouts to ${payee} are allowed` : "The payout rules are up to date",
              );
            } else {
              toast.info("Sent; the updated rules are still being applied");
            }
            onDone?.(result);
          },
          onError: (err: Error) => toast.error(err.message || "Couldn't update the payout rules"),
        })
      }
    >
      {sync.isPending
        ? "Updating the rules…"
        : (label ?? (payee ? `Allow payouts to ${payee}` : "Sign the updated rules"))}
    </Button>
  );
}
