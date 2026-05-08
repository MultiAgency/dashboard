import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/app";
import { Badge, Button, Card, CardContent, Input } from "@/components";
import { Field } from "@/components/admin-form";
import { sessionQueryOptions } from "@/lib/session";
import { useApiClient } from "@/lib/use-api-client";

export const Route = createFileRoute("/_layout/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "Workspace | app" },
      { name: "description", content: "Your workspace center." },
    ],
  }),
  component: Home,
});

function Home() {
  const apiClient = useApiClient();
  const { data: session } = useQuery(sessionQueryOptions());
  const settingsQuery = useQuery({
    queryKey: ["settings", "public"],
    queryFn: () => apiClient.settings.getPublic(),
    staleTime: 5 * 60_000,
  });
  const user = session?.user;
  const nearAccountId = authClient.near.getAccountId();

  if (!user || settingsQuery.isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Loading workspace...
        </CardContent>
      </Card>
    );
  }

  if (settingsQuery.data?.isPlaceholder) {
    return <SetupYourAgency />;
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardContent className="p-6 sm:p-8 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">workspace</Badge>
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                {user.name || user.id.slice(0, 8)}
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Manage identity and settings.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/settings">identity settings</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/team">team</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              identity status
            </div>
            <InfoRow label="near" value={nearAccountId ?? "not linked"} mono />
          </CardContent>
        </Card>
      </section>

      <MyAssignedProjects />
    </div>
  );
}

function SetupYourAgency() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [daoAccountId, setDaoAccountId] = useState("");
  const [adminRoleName, setAdminRoleName] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const claim = useMutation({
    mutationFn: () =>
      apiClient.bootstrap.config({
        daoAccountId: daoAccountId.trim(),
        ...(adminRoleName.trim() ? { adminRoleName: adminRoleName.trim() } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "public"] });
      toast.success("Agency claimed");
      navigate({ to: "/settings" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canSubmit = daoAccountId.trim().length > 0 && !claim.isPending;

  return (
    <Card>
      <CardContent className="p-6 sm:p-8 space-y-6 max-w-xl">
        <div className="space-y-2">
          <Badge variant="outline">bootstrap</Badge>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Set up your agency</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Point this dashboard at your Sputnik DAO to get started. You must be Admin on the
            destination DAO. Once configured, the rest of the agency identity (name, taglines, NEARN
            slug) is editable from settings.
          </p>
        </div>

        <Field label="DAO account ID">
          <Input
            value={daoAccountId}
            onChange={(e) => setDaoAccountId(e.target.value)}
            placeholder="your-dao.sputnik-dao.near"
            disabled={claim.isPending}
          />
        </Field>

        {showAdvanced ? (
          <Field label="Admin role name">
            <Input
              value={adminRoleName}
              onChange={(e) => setAdminRoleName(e.target.value)}
              placeholder="Admin"
              disabled={claim.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Defaults to <code>Admin</code> (Trezu convention). Use <code>council</code> for raw
              Sputnik DAOs, or whatever role name your DAO's policy uses.
            </p>
          </Field>
        ) : (
          <button
            type="button"
            onClick={() => setShowAdvanced(true)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Advanced: admin role name
          </button>
        )}

        <Button onClick={() => claim.mutate()} disabled={!canSubmit}>
          {claim.isPending ? "Claiming..." : "Set up your agency"}
        </Button>
      </CardContent>
    </Card>
  );
}

function MyAssignedProjects() {
  const apiClient = useApiClient();
  const query = useQuery({
    queryKey: ["me", "assigned-projects"],
    queryFn: () => apiClient.me.assignedProjects(),
    retry: false,
    staleTime: 30_000,
  });

  if (query.isLoading || query.isError || !query.data || query.data.data.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">Your assigned projects</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {query.data.data.map((p) => (
          <Card key={p.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={p.status === "active" ? "default" : "outline"}>{p.status}</Badge>
                {p.role && <Badge variant="outline">{p.role}</Badge>}
              </div>
              <div className="font-semibold tracking-tight break-all">{p.title}</div>
              <div className="text-xs font-mono text-muted-foreground">@{p.slug}</div>
              <Button asChild size="sm" variant="outline" className="w-full">
                <Link to="/admin/projects/$slug" params={{ slug: p.slug }}>
                  open
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-sm border border-border bg-muted/10 p-3 grid gap-1 sm:grid-cols-[100px_1fr] sm:gap-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={mono ? "text-xs font-mono break-all" : "text-sm break-all"}>{value}</div>
    </div>
  );
}
