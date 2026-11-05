import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAuthClient } from "@/app";
import { Alert, AlertDescription, AlertTitle } from "@/components";
import { isPlaceholderAgencyName } from "@/lib/agency-name";
import { useApiClient } from "@/lib/api";
import { sessionQueryOptions } from "@/lib/auth";
import { myOrganizationsQueryOptions } from "@/lib/queries";

export function useActiveOrganization() {
  const authClient = useAuthClient();
  const apiClient = useApiClient();
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const organizations = useQuery(myOrganizationsQueryOptions(apiClient)).data?.data ?? [];
  return organizations.find((o) => o.id === session?.session?.activeOrganizationId) ?? null;
}

export function AgencyNamePrompt({ linkToSettings = true }: { linkToSettings?: boolean }) {
  const active = useActiveOrganization();
  if (!active || !isPlaceholderAgencyName(active.name, active.id)) return null;
  return (
    <Alert>
      <AlertTitle>
        {active.name.trim()
          ? `“${active.name.trim()}” looks like a placeholder name`
          : "Your agency has no name"}
      </AlertTitle>
      <AlertDescription>
        <span>
          Builders see your agency name in every email.{" "}
          {linkToSettings ? (
            <>
              Rename it in{" "}
              <Link
                to="/admin/settings"
                hash="organization"
                className="font-medium underline underline-offset-4"
              >
                Settings → Organization
              </Link>
              .
            </>
          ) : (
            "Rename it below."
          )}
        </span>
      </AlertDescription>
    </Alert>
  );
}
