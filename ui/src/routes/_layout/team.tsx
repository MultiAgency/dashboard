import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Badge,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components";
import { ApplicationsAdminSection } from "@/components/applications-admin-section";
import { ContributorsAdminSection } from "@/components/contributors-admin-section";
import { useMeRoles } from "@/hooks/use-me-roles";
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
  const { canAccessAdmin, isLoaded } = useMeRoles();
  const [selectedMember, setSelectedMember] = useState<string | null>(null);

  const teamQuery = useQuery({
    ...teamListQueryOptions(apiClient),
    initialData: loaderData.team ?? undefined,
  });

  return (
    <div className="space-y-12 pb-12 animate-fade-in">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          agency · team
        </div>
        <h1 className="font-display text-4xl sm:text-6xl font-black uppercase leading-none tracking-tight">
          Team
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Roles, members, and permissions — live from the agency's Sputnik DAO contract.
        </p>
      </header>

      {isLoaded && canAccessAdmin ? (
        <Tabs defaultValue="roles">
          <TabsList variant="line" className="font-mono text-[11px] uppercase tracking-[0.22em]">
            <TabsTrigger value="roles">roles</TabsTrigger>
            <TabsTrigger value="contributors">contributors</TabsTrigger>
            <TabsTrigger value="applications">applications</TabsTrigger>
          </TabsList>
          <TabsContent value="roles" className="mt-6">
            <PublicRoles teamQuery={teamQuery} onSelectMember={setSelectedMember} />
          </TabsContent>
          <TabsContent value="contributors" className="mt-6">
            <ContributorsAdminSection />
          </TabsContent>
          <TabsContent value="applications" className="mt-6">
            <ApplicationsAdminSection />
          </TabsContent>
        </Tabs>
      ) : (
        <PublicRoles teamQuery={teamQuery} onSelectMember={setSelectedMember} />
      )}
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <RoleCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (teamQuery.isError) {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        could not load — try again
      </p>
    );
  }
  if (teamQuery.data && teamQuery.data.roles.length > 0) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {teamQuery.data.roles.map((role) => (
          <RoleCard key={role.name} role={role} onSelectMember={onSelectMember} />
        ))}
      </div>
    );
  }
  return (
    <Empty className="border-2 border-dashed border-border/40">
      <EmptyTitle className="font-display text-2xl uppercase tracking-tight text-muted-foreground">
        no roles defined
      </EmptyTitle>
    </Empty>
  );
}

function RoleCardSkeleton() {
  return (
    <Card className="flex flex-col">
      <CardContent className="p-4 flex-1 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-2/3" />
        <div className="space-y-1 pt-2 border-t border-foreground/20">
          <Skeleton className="h-3 w-20" />
          <div className="flex flex-wrap gap-1">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-10" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RoleCard({
  role,
  onSelectMember,
}: {
  role: Role;
  onSelectMember: (account: string) => void;
}) {
  return (
    <Card className="flex flex-col">
      <CardContent className="p-4 flex-1 flex flex-col gap-3">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="truncate">{role.name}</span>
          <span>
            {role.isEveryone
              ? "everyone"
              : `${role.members.length} member${role.members.length === 1 ? "" : "s"}`}
          </span>
        </div>
        {role.isEveryone ? (
          <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
            open to anyone
          </p>
        ) : role.members.length === 0 ? (
          <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
            no members
          </p>
        ) : (
          <div className="grid gap-1">
            {role.members.map((acct) => (
              <button
                key={acct}
                type="button"
                onClick={() => onSelectMember(acct)}
                aria-label={`Open ${acct} details`}
                className="font-mono text-xs truncate text-left hover:text-foreground/70 focus:outline-none focus-visible:underline cursor-pointer"
              >
                {acct}
              </button>
            ))}
          </div>
        )}
        {role.permissions.length > 0 && (
          <div className="space-y-1 pt-2 border-t border-foreground/20">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              permissions
            </div>
            <div className="flex flex-wrap gap-1">
              {role.permissions.map((p) => (
                <Badge
                  key={p}
                  variant="outline"
                  className="font-mono text-[10px] uppercase tracking-wide border-foreground/40 text-muted-foreground"
                >
                  {p}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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
  if (!accountId) {
    return (
      <Dialog open={false} onOpenChange={onOpenChange}>
        <DialogContent />
      </Dialog>
    );
  }
  const heldRoles = roles.filter((r) => !r.isEveryone && r.members.includes(accountId));
  const openRoles = roles.filter((r) => r.isEveryone);
  const permissions = Array.from(new Set(heldRoles.flatMap((r) => r.permissions))).sort();
  return (
    <Dialog open={!!accountId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em]">
            <span className="text-muted-foreground">member</span>
            <Badge variant="outline">
              {heldRoles.length} role{heldRoles.length === 1 ? "" : "s"}
            </Badge>
          </div>
          <DialogTitle className="font-display text-2xl uppercase tracking-tight font-extrabold leading-tight break-all">
            {accountId}
          </DialogTitle>
          <DialogDescription className="sr-only">
            DAO roles and permissions for {accountId}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              roles held
            </div>
            {heldRoles.length === 0 ? (
              <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                no explicit roles
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {heldRoles.map((r) => (
                  <Badge
                    key={r.name}
                    variant="outline"
                    className="font-mono text-[10px] uppercase tracking-wide"
                  >
                    {r.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          {openRoles.length > 0 && (
            <div className="space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                open roles
              </div>
              <div className="flex flex-wrap gap-1">
                {openRoles.map((r) => (
                  <Badge
                    key={r.name}
                    variant="outline"
                    className="font-mono text-[10px] uppercase tracking-wide border-foreground/30 text-muted-foreground"
                  >
                    {r.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              permissions
            </div>
            {permissions.length === 0 ? (
              <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                none — read-only
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {permissions.map((p) => (
                  <Badge
                    key={p}
                    variant="outline"
                    className="font-mono text-[10px] uppercase tracking-wide border-foreground/40 text-muted-foreground"
                  >
                    {p}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
