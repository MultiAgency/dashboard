import {
  type UseQueryResult,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyTitle,
  Input,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty as AdminEmpty, Field, Loading, selectClass } from "@/components/admin-form";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import {
  adminContributorsListQueryKey,
  adminContributorsListQueryOptions,
  teamListQueryOptions,
} from "@/lib/queries";

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

// ── Applications admin section (absorbed from applications-admin-section.tsx) ──

type ApplicationKind = "founder" | "contributor" | "client";
type ApplicationStatus = "new" | "reviewing" | "accepted" | "declined";

type Application = {
  id: string;
  kind: ApplicationKind;
  name: string;
  email: string;
  nearAccountId: string | null;
  message: string | null;
  metadata: string | null;
  status: ApplicationStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

function ApplicationsAdminSection() {
  const apiClient = useApiClient();
  const [filterKind, setFilterKind] = useState<ApplicationKind | "">("");
  const [filterStatus, setFilterStatus] = useState<ApplicationStatus | "">("new");

  const applicationsQuery = useInfiniteQuery({
    queryKey: ["admin", "applications", "list", filterKind || null, filterStatus || null],
    queryFn: ({ pageParam }) =>
      apiClient.applications.list({
        kind: filterKind || undefined,
        status: filterStatus || undefined,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });

  if (applicationsQuery.isError) {
    return <AdminError error={applicationsQuery.error} />;
  }

  const apps = applicationsQuery.data?.pages.flatMap((p) => p.data) ?? [];
  const filtersActive = filterKind !== "" || filterStatus !== "new";

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5 grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="kind" htmlFor="filter-kind">
            <select
              id="filter-kind"
              value={filterKind}
              onChange={(e) => setFilterKind(e.target.value as ApplicationKind | "")}
              className={selectClass}
            >
              <option value="">all kinds</option>
              <option value="founder">founder</option>
              <option value="contributor">contributor</option>
              <option value="client">client</option>
            </select>
          </Field>
          <Field label="status" htmlFor="filter-status">
            <select
              id="filter-status"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as ApplicationStatus | "")}
              className={selectClass}
            >
              <option value="">all statuses</option>
              <option value="new">new</option>
              <option value="reviewing">reviewing</option>
              <option value="accepted">accepted</option>
              <option value="declined">declined</option>
            </select>
          </Field>
          <div className="flex items-end">
            <Button
              variant="outline"
              size="sm"
              disabled={!filtersActive}
              onClick={() => {
                setFilterKind("");
                setFilterStatus("new");
              }}
            >
              reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {applicationsQuery.isLoading ? (
        <Loading label="Loading applications..." />
      ) : apps.length > 0 ? (
        <>
          <div className="space-y-3">
            {apps.map((a) => (
              <ApplicationCard key={a.id} application={a} />
            ))}
          </div>
          {applicationsQuery.hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => applicationsQuery.fetchNextPage()}
                disabled={applicationsQuery.isFetchingNextPage}
              >
                {applicationsQuery.isFetchingNextPage ? "loading..." : "load more"}
              </Button>
            </div>
          )}
        </>
      ) : (
        <AdminEmpty
          label={
            filtersActive
              ? "No applications match the current filters."
              : "No applications submitted yet."
          }
        />
      )}
    </div>
  );
}

function ApplicationCard({ application }: { application: Application }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: async (status: ApplicationStatus) =>
      apiClient.applications.update({ id: application.id, status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "applications", "list"] });
      toast.success("Status updated");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to update status"),
  });

  const isPending = updateMutation.isPending;

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={application.status === "new" ? "default" : "outline"}>
                {application.status}
              </Badge>
              <Badge variant="outline">{application.kind}</Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(application.createdAt).toISOString().slice(0, 10)}
              </span>
            </div>
            <div className="font-display text-lg uppercase tracking-tight font-extrabold leading-tight break-all">
              {application.name}
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div className="font-mono break-all">{application.email}</div>
              {application.nearAccountId && (
                <div className="font-mono break-all">{application.nearAccountId}</div>
              )}
            </div>
          </div>
        </div>

        {application.message && (
          <div className="rounded-sm border border-border bg-muted/10 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              message
            </div>
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
              {application.message}
            </p>
          </div>
        )}

        {application.metadata && (
          <div className="rounded-sm border border-border bg-muted/10 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              metadata
            </div>
            <pre className="text-xs font-mono text-muted-foreground leading-relaxed whitespace-pre-wrap break-all">
              {application.metadata}
            </pre>
          </div>
        )}

        {application.reviewedAt && (
          <div className="text-xs text-muted-foreground">
            last reviewed{" "}
            {application.reviewedBy && (
              <>
                by <span className="font-mono">{application.reviewedBy}</span> ·{" "}
              </>
            )}
            {new Date(application.reviewedAt).toISOString().slice(0, 19).replace("T", " ")}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          {transitionsFor(application.status).map((t) => (
            <Button
              key={t.to}
              variant={t.variant}
              size="sm"
              onClick={() => updateMutation.mutate(t.to)}
              disabled={isPending}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function transitionsFor(status: ApplicationStatus): {
  to: ApplicationStatus;
  label: string;
  variant: "default" | "outline" | "destructive";
}[] {
  switch (status) {
    case "new":
      return [
        { to: "reviewing", label: "start review", variant: "default" },
        { to: "accepted", label: "accept", variant: "default" },
        { to: "declined", label: "decline", variant: "destructive" },
      ];
    case "reviewing":
      return [
        { to: "accepted", label: "accept", variant: "default" },
        { to: "declined", label: "decline", variant: "destructive" },
        { to: "new", label: "back to new", variant: "outline" },
      ];
    case "accepted":
      return [
        { to: "reviewing", label: "back to review", variant: "outline" },
        { to: "declined", label: "decline", variant: "destructive" },
      ];
    case "declined":
      return [
        { to: "reviewing", label: "back to review", variant: "outline" },
        { to: "accepted", label: "accept", variant: "default" },
      ];
  }
}

// ── Contributors admin section (absorbed from contributors-admin-section.tsx) ──

type OnboardingStatus = "pending" | "complete" | "expired";

type Contributor = {
  id: string;
  name: string;
  email: string | null;
  nearAccountId: string | null;
  onboardingStatus: OnboardingStatus;
};

function ContributorsAdminSection() {
  const apiClient = useApiClient();
  const contributorsQuery = useQuery(adminContributorsListQueryOptions(apiClient));

  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (contributorsQuery.isError) {
    return <AdminError error={contributorsQuery.error} />;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-end gap-3">
        <Button
          onClick={() => setCreating((v) => !v)}
          variant={creating ? "outline" : "default"}
          className="font-display uppercase tracking-wide"
        >
          {creating ? "cancel" : "+ new contributor"}
        </Button>
      </header>

      {creating && <ContributorCreateForm onDone={() => setCreating(false)} />}

      {contributorsQuery.isLoading ? (
        <Loading label="Loading contributors..." />
      ) : contributorsQuery.data && contributorsQuery.data.data.length > 0 ? (
        <div className="space-y-3">
          {contributorsQuery.data.data.map((c) => (
            <ContributorRow
              key={c.id}
              contributor={c}
              expanded={selectedId === c.id}
              onToggle={() => setSelectedId((s) => (s === c.id ? null : c.id))}
            />
          ))}
        </div>
      ) : (
        <AdminEmpty label="No contributors yet. Create your first one above." />
      )}
    </div>
  );
}

function ContributorRow({
  contributor,
  expanded,
  onToggle,
}: {
  contributor: Contributor;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-start justify-between gap-4 text-left"
        >
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={contributor.onboardingStatus === "complete" ? "default" : "outline"}>
                {contributor.onboardingStatus}
              </Badge>
            </div>
            <div className="font-display text-lg uppercase tracking-tight font-extrabold leading-tight break-all">
              {contributor.name}
            </div>
            {contributor.nearAccountId && (
              <div className="text-xs font-mono text-muted-foreground">
                {contributor.nearAccountId}
              </div>
            )}
          </div>
          <div className="text-xs text-muted-foreground font-mono">{expanded ? "−" : "+"}</div>
        </button>

        {expanded && (
          <div className="space-y-4 pt-2 border-t border-border">
            <ContributorEditForm contributor={contributor} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ContributorCreateForm({ onDone }: { onDone: () => void }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [nearAccountId, setNearAccountId] = useState("");
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus>("pending");

  const createMutation = useMutation({
    mutationFn: async () =>
      apiClient.contributors.create({
        name: name.trim(),
        email: email.trim() || undefined,
        nearAccountId: nearAccountId.trim() || undefined,
        onboardingStatus,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminContributorsListQueryKey });
      toast.success("Contributor created");
      onDone();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to create contributor"),
  });

  const isPending = createMutation.isPending;
  const canSubmit = name.trim().length > 0 && !isPending;

  return (
    <Card>
      <CardContent className="p-5 grid gap-4">
        <Field label="name" htmlFor="new-name">
          <Input
            id="new-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isPending}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="email" htmlFor="new-email">
            <Input
              id="new-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isPending}
            />
          </Field>
          <Field label="near account" htmlFor="new-near">
            <Input
              id="new-near"
              value={nearAccountId}
              onChange={(e) => setNearAccountId(e.target.value)}
              placeholder="contributor.near"
              disabled={isPending}
            />
          </Field>
        </div>
        <Field label="onboarding status" htmlFor="new-onboarding">
          <select
            id="new-onboarding"
            value={onboardingStatus}
            onChange={(e) => setOnboardingStatus(e.target.value as OnboardingStatus)}
            disabled={isPending}
            className={selectClass}
          >
            <option value="pending">pending</option>
            <option value="complete">complete</option>
            <option value="expired">expired</option>
          </select>
        </Field>
        <div className="flex gap-2">
          <Button onClick={() => createMutation.mutate()} disabled={!canSubmit}>
            {isPending ? "creating..." : "create contributor"}
          </Button>
          <Button onClick={onDone} variant="outline" disabled={isPending}>
            cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ContributorEditForm({ contributor }: { contributor: Contributor }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState(contributor.name);
  const [email, setEmail] = useState(contributor.email ?? "");
  const [nearAccountId, setNearAccountId] = useState(contributor.nearAccountId ?? "");
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus>(
    contributor.onboardingStatus,
  );

  useEffect(() => {
    setName(contributor.name);
    setEmail(contributor.email ?? "");
    setNearAccountId(contributor.nearAccountId ?? "");
    setOnboardingStatus(contributor.onboardingStatus);
  }, [contributor]);

  const updateMutation = useMutation({
    mutationFn: async () =>
      apiClient.contributors.update({
        id: contributor.id,
        name: name.trim(),
        email: email.trim() || null,
        nearAccountId: nearAccountId.trim() || null,
        onboardingStatus,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminContributorsListQueryKey });
      toast.success("Contributor updated");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to update contributor"),
  });

  const isPending = updateMutation.isPending;

  return (
    <div className="grid gap-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        edit
      </div>
      <Field label="name" htmlFor={`edit-name-${contributor.id}`}>
        <Input
          id={`edit-name-${contributor.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isPending}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="email" htmlFor={`edit-email-${contributor.id}`}>
          <Input
            id={`edit-email-${contributor.id}`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isPending}
          />
        </Field>
        <Field label="near account" htmlFor={`edit-near-${contributor.id}`}>
          <Input
            id={`edit-near-${contributor.id}`}
            value={nearAccountId}
            onChange={(e) => setNearAccountId(e.target.value)}
            disabled={isPending}
          />
        </Field>
      </div>
      <Field label="onboarding status" htmlFor={`edit-onboarding-${contributor.id}`}>
        <select
          id={`edit-onboarding-${contributor.id}`}
          value={onboardingStatus}
          onChange={(e) => setOnboardingStatus(e.target.value as OnboardingStatus)}
          disabled={isPending}
          className={selectClass}
        >
          <option value="pending">pending</option>
          <option value="complete">complete</option>
          <option value="expired">expired</option>
        </select>
      </Field>
      <div>
        <Button onClick={() => updateMutation.mutate()} disabled={isPending} size="sm">
          {isPending ? "saving..." : "save changes"}
        </Button>
      </div>
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
