import { BuildingsIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useAuthClient } from "@/app";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadingCard } from "@/components/loading-card";
import { OrganizationRowCard } from "@/components/organization-row-card";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ItemGroup } from "@/components/ui/item";
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

export function MyOrganizations({ emptyAction }: { emptyAction?: ReactNode }) {
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
  const [leaving, setLeaving] = useState<MyMembership | null>(null);

  if (organizationsQuery.isLoading || membershipsQuery.isLoading) {
    return <LoadingCard label="organizations" />;
  }

  const memberships = membershipsQuery.data ?? [];
  if (memberships.length === 0) {
    return (
      <Empty variant="outline">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BuildingsIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>No Organizations yet</EmptyTitle>
          <EmptyDescription>
            Accept an invitation or create an Organization to start working with a team.
          </EmptyDescription>
        </EmptyHeader>
        {emptyAction}
      </Empty>
    );
  }

  return (
    <>
      <ItemGroup>
        {memberships.map((membership) => (
          <OrganizationRowCard
            key={membership.organizationId}
            name={membership.name}
            role={membership.role}
            details={
              membership.lastOwner ? (
                <span>Only owner. Make someone else owner to leave.</span>
              ) : undefined
            }
          >
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLeaving(membership)}
              disabled={membership.lastOwner || leave.isPending}
            >
              Leave
            </Button>
          </OrganizationRowCard>
        ))}
      </ItemGroup>
      <ConfirmDialog
        open={!!leaving}
        onOpenChange={(open) => !open && setLeaving(null)}
        title={`Leave ${leaving?.name ?? "Organization"}?`}
        description="You lose access to its Projects and Engagements until someone invites you again."
        confirmLabel="Leave"
        cancelLabel="Cancel"
        destructive
        onConfirm={async () => {
          if (leaving) await leave.mutateAsync(leaving.organizationId).catch(() => {});
        }}
      />
    </>
  );
}
