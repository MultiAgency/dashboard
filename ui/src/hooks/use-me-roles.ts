import { useQuery } from "@tanstack/react-query";
import { useAuthClient } from "@/app";
import { useApiClient } from "@/lib/api";
import { sessionQueryOptions } from "@/lib/auth";
import { meRolesQueryOptions } from "@/lib/queries";

export function useMeRoles() {
  const authClient = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const isAuthenticated = !!session?.user;
  const apiClient = useApiClient();

  const query = useQuery({ ...meRolesQueryOptions(apiClient), enabled: isAuthenticated });

  const orgRole = query.data?.orgRole ?? null;
  const canAccessAdmin = orgRole === "admin";
  const isLoaded = !isAuthenticated || query.isSuccess;

  return {
    isAuthenticated,
    orgRole,
    canAccessAdmin,
    isLoaded,
  };
}
