import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { type DataChange, refreshAfter } from "@/lib/queries";

export function useRefreshingMutation<TInput, TResult>(
  change: DataChange,
  action: (input: TInput) => Promise<TResult>,
  success: string | ((result: TResult) => string),
  failure?: (result: TResult) => string | undefined,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: async (result) => {
      await refreshAfter(queryClient, change);
      const failed = failure?.(result);
      if (failed) toast.error(failed);
      else toast.success(typeof success === "string" ? success : success(result));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
