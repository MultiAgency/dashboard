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

  const isAdmin = !!query.data?.isAdmin;
  const isContributor = !!query.data?.isContributor;
  const isClient = !!query.data?.isClient;
  const isSuperAdmin = !!query.data?.isSuperAdmin;
  const canAccessAdmin = (isAdmin || isContributor) && !isSuperAdmin;
  const isLoaded = !isAuthenticated || query.isSuccess;

  return {
    isAuthenticated,
    isAdmin,
    isContributor,
    isClient,
    isSuperAdmin,
    canAccessAdmin,
    isLoaded,
  };
}
