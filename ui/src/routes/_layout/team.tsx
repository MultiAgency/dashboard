import { UsersThreeIcon } from "@phosphor-icons/react";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Separator,
  Skeleton,
} from "@/components";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { useApiClient } from "@/lib/api";
import { teamListQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/team")({
  head: () => ({
    meta: [{ title: "Team" }, { name: "description", content: "Roles defined on the agency DAO." }],
  }),
  loader: async ({ context }) => {
    const team = await context.queryClient
      .ensureQueryData(teamListQueryOptions(context.apiClient))
      .catch(() => null);

    return { team };
  },
  component: Team,
});

type Role = {
  name: string;
  isEveryone: boolean;
  members: string[];
  permissions: string[];
};

function Team() {
  const loaderData = Route.useLoaderData();
  const apiClient = useApiClient();
  const [selectedMember, setSelectedMember] = useState<string | null>(null);

  const teamQuery = useQuery({
    ...teamListQueryOptions(apiClient),
    initialData: loaderData.team ?? undefined,
  });

  return (
    <div className="flex animate-fade-in flex-col gap-8">
      <PageHeader
        title="Team"
        description="Roles, members and permissions, live from the Agency DAO contract."
      />

      <PublicRoles teamQuery={teamQuery} onSelectMember={setSelectedMember} />
      <MemberDetailDialog
        accountId={selectedMember}
        roles={teamQuery.data?.roles ?? []}
        onOpenChange={(open) => {
          if (!open) setSelectedMember(null);
        }}
      />
    </div>
  );
}

type TeamQuery = UseQueryResult<{ roles: Role[] }>;

function PublicRoles({
  teamQuery,
  onSelectMember,
}: {
  teamQuery: TeamQuery;
  onSelectMember: (account: string) => void;
}) {
  if (teamQuery.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <RoleCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (teamQuery.isError) {
    return <LoadError title="Could not load the team" onRetry={() => teamQuery.refetch()} />;
  }
  if (teamQuery.data && teamQuery.data.roles.length > 0) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {teamQuery.data.roles.map((role) => (
          <RoleCard key={role.name} role={role} onSelectMember={onSelectMember} />
        ))}
      </div>
    );
  }
  return (
    <Empty variant="outline">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <UsersThreeIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>No roles defined</EmptyTitle>
        <EmptyDescription>The DAO has no roles yet.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function RoleCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-16" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-2/3" />
        <div className="flex flex-wrap gap-1">
          <Skeleton className="h-5 w-12" />
          <Skeleton className="h-5 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

function memberCount(role: Role) {
  if (role.isEveryone) return "Everyone";
  return `${role.members.length} member${role.members.length === 1 ? "" : "s"}`;
}

function RoleCard({
  role,
  onSelectMember,
}: {
  role: Role;
  onSelectMember: (account: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="truncate">{role.name}</h2>
        </CardTitle>
        <CardDescription>{memberCount(role)}</CardDescription>
        <CardAction>
          <Badge variant="outline">
            {role.permissions.length} permission{role.permissions.length === 1 ? "" : "s"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {role.isEveryone ? (
          <p className="text-xs text-muted-foreground">Open to anyone.</p>
        ) : role.members.length === 0 ? (
          <p className="text-xs text-muted-foreground">No members.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {role.members.map((acct) => (
              <li key={acct} className="flex min-w-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full min-w-0 justify-start"
                  onClick={() => onSelectMember(acct)}
                  aria-label={`Open ${acct} details`}
                >
                  <span className="truncate">{acct}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        {role.permissions.length > 0 && (
          <>
            <Separator />
            <BadgeList label="Permissions" items={role.permissions} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BadgeList({ label, items, empty }: { label: string; items: string[]; empty?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs text-muted-foreground">{label}</h3>
      {items.length === 0 ? (
        <p className="text-xs">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((item) => (
            <Badge key={item} variant="outline">
              {item}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function MemberDetailDialog({
  accountId,
  roles,
  onOpenChange,
}: {
  accountId: string | null;
  roles: Role[];
  onOpenChange: (open: boolean) => void;
}) {
  const heldRoles = accountId
    ? roles.filter((r) => !r.isEveryone && r.members.includes(accountId))
    : [];
  const openRoles = roles.filter((r) => r.isEveryone);
  const permissions = Array.from(new Set(heldRoles.flatMap((r) => r.permissions))).sort();
  return (
    <Dialog open={!!accountId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {accountId && (
          <>
            <DialogHeader>
              <DialogTitle className="break-all">{accountId}</DialogTitle>
              <DialogDescription>
                DAO member with {heldRoles.length} role{heldRoles.length === 1 ? "" : "s"}.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <BadgeList
                label="Roles held"
                items={heldRoles.map((r) => r.name)}
                empty="No explicit roles."
              />
              {openRoles.length > 0 && (
                <BadgeList label="Open roles" items={openRoles.map((r) => r.name)} />
              )}
              <BadgeList label="Permissions" items={permissions} empty="None, read-only." />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
