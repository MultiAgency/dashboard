import { useQuery } from "@tanstack/react-query";
import { useAuthClient } from "@/app";
import { Button } from "@/components";
import { Empty } from "@/components/admin-form";
import { LoadingCard } from "@/components/loading-card";
import { OrganizationRowCard } from "@/components/organization-row-card";
import { useLeaveOrganization } from "@/hooks/use-leave-organization";
import { organizationsQueryOptions } from "@/lib/account";
import { sessionQueryOptions } from "@/lib/auth";
import { nonPersonalOrganizations } from "@/lib/landing";
import { isLastOwner } from "@/lib/membership";

type MyMembership = {
  organizationId: string;
  name: string;
  role: string | null;
  lastOwner: boolean;
};

export function MyOrganizations() {
  const authClient = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const userId = session?.user?.id;
  const organizationsQuery = useQuery(organizationsQueryOptions(authClient));
  const organizations = nonPersonalOrganizations(organizationsQuery.data ?? []);

  const membershipsQuery = useQuery({
    queryKey: ["organizations", "memberships", userId, organizations.map((o) => o.id)],
    queryFn: async (): Promise<MyMembership[]> =>
      Promise.all(
        organizations.map(async (organization) => {
          const { data } = await authClient.organization.getFullOrganization({
            query: { organizationId: organization.id },
          });
          const members = data?.members ?? [];
          const mine = members.find((m) => m.userId === userId);
          return {
            organizationId: organization.id,
            name: organization.name,
            role: mine?.role ?? null,
            lastOwner: mine ? isLastOwner(members, mine.id) : false,
          };
        }),
      ),
    enabled: !!userId && organizationsQuery.isSuccess,
  });

  const leave = useLeaveOrganization();

  if (organizationsQuery.isLoading || membershipsQuery.isLoading) {
    return <LoadingCard label="organizations" />;
  }

  const memberships = membershipsQuery.data ?? [];
  if (memberships.length === 0) {
    return <Empty label="You are not a member of any Organization." />;
  }

  return (
    <div className="grid gap-3">
      {memberships.map((membership) => (
        <OrganizationRowCard
          key={membership.organizationId}
          name={membership.name}
          role={membership.role}
        >
          <div className="space-y-1 sm:text-right">
            <Button
              size="sm"
              variant="outline"
              onClick={() => leave.mutate(membership.organizationId)}
              disabled={membership.lastOwner || leave.isPending}
            >
              leave
            </Button>
            {membership.lastOwner && (
              <p className="text-xs text-muted-foreground">
                You are the only owner. Make someone else owner before leaving.
              </p>
            )}
          </div>
        </OrganizationRowCard>
      ))}
    </div>
  );
}
