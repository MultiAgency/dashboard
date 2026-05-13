import { useQuery } from "@tanstack/react-query";
import { useAuthClient } from "@/app";
import { useApiClient } from "@/lib/api";
import { sessionQueryOptions } from "@/lib/auth";

export function useMeRoles() {
  const authClient = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const isAuthenticated = !!session?.user;
  const apiClient = useApiClient();

  const query = useQuery({
    queryKey: ["me", "roles"],
    queryFn: () => apiClient.me.roles(),
    enabled: isAuthenticated,
    staleTime: 60_000,
    retry: false,
  });

  const isAdmin = !!query.data?.isAdmin;
  const isApprover = !!query.data?.isApprover;
  const isRequestor = !!query.data?.isRequestor;
  const isOperator = isAdmin || isApprover;
  const isLoaded = !isAuthenticated || query.isSuccess;

  return { isAuthenticated, isAdmin, isApprover, isRequestor, isOperator, isLoaded };
}
