import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge, Card, CardContent } from "@/components";
import { useApiClient } from "@/lib/use-api-client";

export const Route = createFileRoute("/_layout/_authenticated/_configured/team")({
  head: () => ({
    meta: [{ title: "Team" }],
  }),
  component: Team,
});

function Team() {
  const apiClient = useApiClient();
  const query = useQuery({
    queryKey: ["team", "list"],
    queryFn: () => apiClient.team.list(),
    retry: false,
    staleTime: 60_000,
  });

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Roles defined in the agency's Sputnik DAO contract. Names and members come from the chain
          — whatever the DAO has configured.
        </p>
      </header>

      {query.isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent>
        </Card>
      ) : query.isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Could not load roles from chain.
          </CardContent>
        </Card>
      ) : query.data && query.data.roles.length > 0 ? (
        <div className="space-y-6">
          {query.data.roles.map((role) => (
            <RoleSection key={role.name} role={role} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No roles defined on the DAO.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RoleSection({
  role,
}: {
  role: {
    name: string;
    isEveryone: boolean;
    members: string[];
    permissions: string[];
  };
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{role.name}</h2>
        {role.isEveryone && <Badge variant="outline">everyone</Badge>}
      </div>
      <Card>
        <CardContent className="p-4 space-y-3">
          {role.isEveryone ? (
            <p className="text-xs text-muted-foreground">
              This role is open to anyone — no specific member list.
            </p>
          ) : role.members.length === 0 ? (
            <p className="text-xs text-muted-foreground">No members.</p>
          ) : (
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {role.members.map((acct) => (
                <div key={acct} className="text-xs font-mono break-all">
                  {acct}
                </div>
              ))}
            </div>
          )}
          {role.permissions.length > 0 && (
            <div className="space-y-1 pt-2 border-t border-border">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                permissions
              </div>
              <div className="flex flex-wrap gap-1">
                {role.permissions.map((p) => (
                  <span
                    key={p}
                    className="text-[10px] font-mono rounded-sm border border-border px-1.5 py-0.5 text-muted-foreground"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
