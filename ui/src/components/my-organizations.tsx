import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Badge, Button, Card, CardContent } from "@/components";
import { Empty } from "@/components/admin-form";
import { organizationsQueryOptions, refreshAccountQueries } from "@/lib/account";
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
  const queryClient = useQueryClient();
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

  const leave = useMutation({
    mutationFn: async (organizationId: string) => {
      const { error } = await authClient.organization.leave({ organizationId });
      if (error) throw new Error(error.message ?? "Could not leave the Organization");
    },
    onSuccess: async () => {
      toast.success("You left the Organization");
      await refreshAccountQueries(queryClient);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (organizationsQuery.isLoading || membershipsQuery.isLoading) {
    return (
      <Card>
        <CardContent className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
          loading organizations...
        </CardContent>
      </Card>
    );
  }

  const memberships = membershipsQuery.data ?? [];
  if (memberships.length === 0) {
    return <Empty label="You are not a member of any Organization." />;
  }

  return (
    <div className="grid gap-3">
      {memberships.map((membership) => (
        <Card key={membership.organizationId}>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1 min-w-0">
              <div className="font-display text-xl uppercase tracking-tight font-extrabold leading-tight break-words">
                {membership.name}
              </div>
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                {membership.role ?? "member"}
              </Badge>
            </div>
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
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
