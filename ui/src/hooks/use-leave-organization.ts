import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { refreshAccountQueries } from "@/lib/account";

export function useLeaveOrganization(onLeft?: () => void) {
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (organizationId: string) => {
      const { error } = await authClient.organization.leave({ organizationId });
      if (error) throw new Error(error.message ?? "Could not leave the Organization");
    },
    onSuccess: async () => {
      toast.success("You left the Organization");
      await refreshAccountQueries(queryClient);
      onLeft?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
