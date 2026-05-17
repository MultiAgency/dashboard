import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, Empty, EmptyTitle, Skeleton } from "@/components";
import { ApplicationsAdminSection } from "@/components/applications-admin-section";
import { ContributorsAdminSection } from "@/components/contributors-admin-section";
import { UnclaimedState } from "@/components/unclaimed-state";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { publicSettingsQueryOptions, teamListQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/team")({
  head: () => ({
    meta: [{ title: "Team" }, { name: "description", content: "Roles defined on the agency DAO." }],
  }),
  loader: async ({ context }) => {
    const settings = await context.queryClient
      .ensureQueryData(publicSettingsQueryOptions(context.apiClient))
      .catch(() => null);

    let team = null;
    if (settings && !settings.isPlaceholder) {
      team = await context.queryClient
        .ensureQueryData(teamListQueryOptions(context.apiClient))
        .catch(() => null);
    }

    return { settings, team };
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
  const { isOperator, isLoaded } = useMeRoles();

  const settingsQuery = useQuery({
    ...publicSettingsQueryOptions(apiClient),
    initialData: loaderData.settings ?? undefined,
  });

  const teamQuery = useQuery({
    ...teamListQueryOptions(apiClient),
    initialData: loaderData.team ?? undefined,
  });

  if (settingsQuery.data?.isPlaceholder) {
    return (
      <UnclaimedState title="Team">
        Once configured, roles and members are pulled live from the DAO contract.
      </UnclaimedState>
    );
  }

  return (
    <div className="space-y-12 pb-12 animate-fade-in">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          agency · roles
        </div>
        <h1 className="font-display text-4xl sm:text-6xl font-black uppercase leading-none tracking-tight">
          Team
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Roles, members, and permissions — live from the agency's Sputnik DAO contract.
        </p>
      </header>

      {teamQuery.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <RoleCardSkeleton key={i} />
          ))}
        </div>
      ) : teamQuery.isError ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          could not load — try again
        </p>
      ) : teamQuery.data && teamQuery.data.roles.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {teamQuery.data.roles.map((role) => (
            <RoleCard key={role.name} role={role} />
          ))}
        </div>
      ) : (
        <Empty className="border-2 border-dashed border-border/40">
          <EmptyTitle className="font-display text-2xl uppercase tracking-tight text-muted-foreground">
            no roles defined
          </EmptyTitle>
        </Empty>
      )}

      {isLoaded && isOperator && (
        <>
          <section className="space-y-6">
            <div className="space-y-2">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                operator · contributors
              </div>
              <h2 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
                Manage Contributors
              </h2>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Off-chain contributor records. These may or may not yet be in a DAO role on chain.
              </p>
            </div>
            <ContributorsAdminSection />
          </section>

          <section className="space-y-6">
            <div className="space-y-2">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                operator · applications
              </div>
              <h2 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
                Applications Inbox
              </h2>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Received interest submissions from `/apply`, `/register`, and `/contact`. Filter by
                kind.
              </p>
            </div>
            <ApplicationsAdminSection />
          </section>
        </>
      )}
    </div>
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

function RoleCard({ role }: { role: Role }) {
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
              <div key={acct} className="font-mono text-xs break-all">
                {acct}
              </div>
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
                <span
                  key={p}
                  className="font-mono text-[10px] uppercase tracking-wide border border-foreground/40 px-1.5 py-0.5 text-muted-foreground"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
