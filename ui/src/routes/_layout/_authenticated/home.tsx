import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, ChevronDown, Settings as SettingsIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  Avatar,
  AvatarFallback,
  Button,
  Card,
  CardContent,
  Input,
  Separator,
  Skeleton,
} from "@/components";
import { Field } from "@/components/admin-form";
import { useApiClient } from "@/lib/api";
import { sessionQueryOptions, useAuthClient } from "@/lib/auth";

export const Route = createFileRoute("/_layout/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "Workspace | app" },
      { name: "description", content: "Your workspace center." },
    ],
  }),
  component: Home,
});

type AssignedProject = {
  id: string;
  slug: string;
  title: string;
  status: string;
  role: string | null;
};

function Home() {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const settingsQuery = useQuery({
    queryKey: ["settings", "public"],
    queryFn: () => apiClient.settings.getPublic(),
    staleTime: 5 * 60_000,
  });
  const assignedProjectsQuery = useQuery({
    queryKey: ["me", "assigned-projects"],
    queryFn: () => apiClient.me.assignedProjects(),
    retry: false,
    staleTime: 30_000,
  });

  const user = session?.user;
  const nearAccountId = authClient.near.getAccountId();

  if (!user || settingsQuery.isLoading) {
    return <HomeSkeleton />;
  }

  if (settingsQuery.data?.isPlaceholder) {
    return <SetupYourAgency />;
  }

  const assignedProjects: AssignedProject[] = assignedProjectsQuery.data?.data ?? [];
  const initials = (user.name || user.id).slice(0, 2).toUpperCase();
  const linked = !!nearAccountId;
  const count = assignedProjects.length;
  const countDisplay = String(Math.min(count, 99)).padStart(2, "0");

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card
          className="border-style-solid sm:col-span-2 lg:col-span-3 bg-accent text-accent-foreground border-2 border-foreground relative overflow-hidden animate-fade-in-up shadow-none p-0"
          style={{ animationDelay: "0ms" }}
        >
          <CardContent className="p-6 sm:p-8 pb-6 sm:pb-8 space-y-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em]">
              agency · workspace
            </div>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight uppercase leading-[0.9]">
              {user.name || user.id.slice(0, 8)}
            </h1>
            <div className="font-mono text-xs sm:text-sm break-all">
              {nearAccountId ?? "near · not linked"}
            </div>
            <div className="pt-2">
              <Button
                asChild
                className="border-style-solid bg-foreground text-background hover:bg-foreground/90 border-2 border-foreground font-display uppercase tracking-wide"
              >
                <Link to="/settings">manage identity →</Link>
              </Button>
            </div>
          </CardContent>
          <div aria-hidden className="h-2 hazard-stripe" />
        </Card>

        <Link
          to="/settings"
          aria-label="Open settings"
          className="group bg-foreground text-background border-2 border-foreground border-style-solid hover:bg-foreground/90 transition-colors animate-fade-in-up flex flex-col justify-between p-6 min-h-[180px]"
          style={{ animationDelay: "60ms" }}
        >
          <SettingsIcon className="size-5 text-accent" />
          <div className="space-y-1">
            <div className="font-display text-2xl uppercase tracking-tight font-extrabold leading-none">
              settings
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent flex items-center gap-1">
              configure <ArrowUpRight className="size-3" />
            </div>
          </div>
        </Link>

        <Card
          className="border-style-solid sm:col-span-2 lg:col-span-2 border-2 border-foreground animate-fade-in-up p-0"
          style={{ animationDelay: "120ms" }}
        >
          <CardContent className="p-6 pt-6 space-y-4">
            <div className="flex items-center gap-3">
              <Avatar className="border-2 border-foreground rounded-none size-11">
                <AvatarFallback className="rounded-none text-base">{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="font-display text-xl uppercase tracking-tight font-extrabold truncate leading-tight">
                  {user.name || user.id.slice(0, 12)}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  id card
                </div>
              </div>
              <span className={`stamp text-[10px] ${linked ? "" : "stamp-muted"}`}>
                {linked ? "linked" : "no near"}
              </span>
            </div>
            <Separator className="bg-foreground/20" />
            <dl className="space-y-2">
              <InfoRow label="near" value={nearAccountId ?? "—"} />
              <InfoRow label="id" value={user.id.slice(0, 24)} />
            </dl>
          </CardContent>
        </Card>

        <Card
          className="border-style-solid sm:col-span-2 lg:col-span-2 border-2 border-foreground animate-fade-in-up p-0"
          style={{ animationDelay: "180ms" }}
        >
          <CardContent className="p-6 pt-6 h-full flex flex-col justify-between gap-2 min-h-[180px]">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              on the books
            </div>
            <div className="font-display text-7xl sm:text-8xl font-black tracking-tighter leading-none tabular-nums">
              {assignedProjectsQuery.isLoading ? (
                <Skeleton className="h-20 w-28 rounded-none" />
              ) : (
                countDisplay
              )}
            </div>
            <div className="font-display text-sm uppercase tracking-tight text-muted-foreground">
              assigned project{count === 1 ? "" : "s"}
            </div>
          </CardContent>
        </Card>
      </section>

      <HazardDivider label="assignments" />

      <AssignedProjectsSection
        projects={assignedProjects}
        loading={assignedProjectsQuery.isLoading}
        error={assignedProjectsQuery.isError}
      />
    </div>
  );
}

function HazardDivider({ label }: { label: string }) {
  return (
    <div className="relative py-2">
      <div
        aria-hidden
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 hazard-stripe h-1.5"
      />
      <div className="relative flex justify-center">
        <span className="bg-background px-3 font-display text-xs uppercase tracking-[0.22em] font-bold">
          {label}
        </span>
      </div>
    </div>
  );
}

function AssignedProjectsSection({
  projects,
  loading,
  error,
}: {
  projects: AssignedProject[];
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton
            key={i}
            className="h-44 border-2 border-foreground/30 rounded-none skeleton-hazard"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-style-solid border-2 border-foreground bg-card p-0">
        <CardContent className="p-6 pt-6 font-mono text-xs uppercase tracking-wide text-muted-foreground">
          could not load assignments.
        </CardContent>
      </Card>
    );
  }

  if (projects.length === 0) {
    return (
      <Card className="border-style-solid border-2 border-dashed border-foreground/40 p-0">
        <CardContent className="p-8 pt-8 text-center">
          <div className="font-display text-lg uppercase tracking-tight text-muted-foreground">
            no active assignments
          </div>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            once you're assigned to a project it appears here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => (
        <PermitCard key={p.id} project={p} />
      ))}
    </div>
  );
}

function PermitCard({ project }: { project: AssignedProject }) {
  const isActive = project.status === "active";
  return (
    <Card className="border-style-solid border-2 border-foreground p-0 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between bg-accent text-accent-foreground px-3 py-1.5 border-b-2 border-foreground">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] truncate">
          @{project.slug}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wide">permit</span>
      </div>
      <CardContent className="p-4 pt-4 flex-1 flex flex-col gap-3">
        <h3 className="font-display text-xl uppercase tracking-tight font-extrabold leading-tight break-words">
          {project.title}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`stamp text-[10px] ${isActive ? "" : "stamp-caution"}`}>
            {project.status}
          </span>
          {project.role && (
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              · {project.role}
            </span>
          )}
        </div>
        <div className="mt-auto pt-2">
          <Button
            asChild
            className="border-style-solid w-full bg-foreground text-background hover:bg-accent hover:text-accent-foreground border-2 border-foreground font-display uppercase tracking-wide"
          >
            <Link to="/admin/projects/$slug" params={{ slug: project.slug }}>
              open →
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Skeleton className="sm:col-span-2 lg:col-span-3 h-48 rounded-none border-2 border-foreground/30 skeleton-hazard" />
        <Skeleton className="h-48 rounded-none border-2 border-foreground/30 bg-foreground/80" />
        <Skeleton className="sm:col-span-2 lg:col-span-2 h-44 rounded-none border-2 border-foreground/30" />
        <Skeleton className="sm:col-span-2 lg:col-span-2 h-44 rounded-none border-2 border-foreground/30" />
      </section>
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
    <Card className="border-style-solid border-2 border-foreground animate-fade-in-up max-w-xl p-0 overflow-hidden">
      <div className="flex items-center justify-between bg-accent text-accent-foreground px-6 py-2 border-b-2 border-foreground">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em]">bootstrap</span>
        <span className="font-mono text-[10px] uppercase tracking-wide">permit · 001</span>
      </div>
      <CardContent className="p-6 pt-6 sm:p-8 sm:pt-8 space-y-6">
        <div className="space-y-3">
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight uppercase leading-[0.95]">
            set up your worksite
          </h1>
          <Separator className="bg-foreground" />
          <p className="font-mono text-xs leading-relaxed text-muted-foreground">
            point this dashboard at your sputnik dao to get started. you must be admin on the
            destination dao. once configured, the rest of the agency identity (name, taglines, nearn
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
            <p className="text-xs text-muted-foreground font-mono">
              defaults to <code>Admin</code> (Trezu convention). use <code>council</code> for raw
              sputnik daos, or whatever role name your dao's policy uses.
            </p>
          </Field>
        ) : (
          <button
            type="button"
            onClick={() => setShowAdvanced(true)}
            className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className="size-3" />
            advanced · admin role name
          </button>
        )}

        <Button
          onClick={() => claim.mutate()}
          disabled={!canSubmit}
          className="border-style-solid bg-accent text-accent-foreground hover:bg-accent/90 border-2 border-foreground font-display uppercase tracking-wide"
        >
          {claim.isPending ? "claiming..." : "set up your worksite"}
        </Button>
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[60px_1fr] gap-3 items-baseline">
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </dt>
      <dd className="font-mono text-xs break-all">{value}</dd>
    </div>
  );
}
