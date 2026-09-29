import { useQuery } from "@tanstack/react-query";
import { useAuthClient } from "@/app";
import { useApiClient } from "@/lib/api";
import { sessionQueryOptions } from "@/lib/auth";
import { isManager, isWorkspaceRole } from "@/lib/navigation";
import { meRolesQueryOptions, setActiveOrganizationKey } from "@/lib/queries";

export function useMeRoles() {
  const authClient = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const isAuthenticated = !!session?.user;
  setActiveOrganizationKey(session?.session?.activeOrganizationId);
  const apiClient = useApiClient();

  const query = useQuery({ ...meRolesQueryOptions(apiClient), enabled: isAuthenticated });

  const orgRole = isWorkspaceRole(query.data?.orgRole) ? query.data.orgRole : null;
  const isLoaded = !isAuthenticated || query.isSuccess;

  return {
    isAuthenticated,
    orgRole,
    canAccessAdmin: isManager(orgRole),
    agencyDao: query.data?.agencyDao ?? null,
    hasClientSections: query.data?.capabilities.hasClientSections ?? false,
    isLoaded,
  };
}
