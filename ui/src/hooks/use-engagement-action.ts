import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { EngagementView } from "@/components/engagement-status";
import { refreshAfter } from "@/lib/queries";

export function useEngagementAction<TInput = void>(
  action: (input: TInput) => Promise<EngagementView>,
  success: string | ((engagement: EngagementView, input: TInput) => string),
  options: { failure?: string; onDone?: (engagement: EngagementView) => void } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: async (engagement, input) => {
      await refreshAfter(queryClient, { type: "engagements" });
      toast.success(typeof success === "string" ? success : success(engagement, input));
      options.onDone?.(engagement);
    },
    onError: (e: Error) => toast.error(e.message || options.failure || "Something went wrong"),
  });
}
