import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useApiClient } from "@/lib/api";

export function useBudgetActions(projectId: string) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const router = useRouter();

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "budgets", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "projects", "budget", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "budgets", "agency"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "treasury", "balances"] }),
      router.invalidate(),
    ]);
  };

  const allocate = useMutation({
    mutationFn: (input: { tokenId: string; amount: string; note?: string }) =>
      apiClient.budgets.create({ projectId, ...input }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Budget allocated");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to allocate budget"),
  });

  const deallocate = useMutation({
    mutationFn: (input: { tokenId: string; amount: string; note?: string }) =>
      apiClient.budgets.deallocate({ projectId, ...input }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Budget deallocated");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to deallocate budget"),
  });

  return { allocate, deallocate, invalidate };
}
