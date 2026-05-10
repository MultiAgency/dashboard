import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, Input } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty, Field, Loading, selectClass } from "@/components/admin-form";
import { useApiClient } from "@/lib/api";

export const Route = createFileRoute("/_layout/_authenticated/_configured/admin/contributors")({
  head: () => ({
    meta: [{ title: "Admin · Contributors" }],
  }),
  component: AdminContributors,
});

type OnboardingStatus = "pending" | "complete" | "expired";

type Contributor = {
  id: string;
  name: string;
  email: string | null;
  nearAccountId: string | null;
  onboardingStatus: OnboardingStatus;
};

function AdminContributors() {
  const apiClient = useApiClient();
  const contributorsQuery = useQuery({
    queryKey: ["admin", "contributors", "list"],
    queryFn: () => apiClient.contributors.adminList(),
    retry: false,
  });

  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (contributorsQuery.isError) {
    return <AdminError error={contributorsQuery.error} />;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Contributors</h1>
          <p className="text-sm text-muted-foreground">
            Add contributors and track onboarding status. Assign them to projects from the projects
            page.
          </p>
        </div>
        <Button onClick={() => setCreating((v) => !v)} variant={creating ? "outline" : "default"}>
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
        <Empty label="No contributors yet. Create your first one above." />
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
            <div className="font-semibold tracking-tight break-all">{contributor.name}</div>
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
      apiClient.contributors.adminCreate({
        name: name.trim(),
        email: email.trim() || undefined,
        nearAccountId: nearAccountId.trim() || undefined,
        onboardingStatus,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "contributors", "list"] });
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
      apiClient.contributors.adminUpdate({
        id: contributor.id,
        name: name.trim(),
        email: email.trim() || null,
        nearAccountId: nearAccountId.trim() || null,
        onboardingStatus,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "contributors", "list"] });
      toast.success("Contributor updated");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to update contributor"),
  });

  const isPending = updateMutation.isPending;

  return (
    <div className="grid gap-4">
      <h3 className="font-semibold tracking-tight">Edit</h3>
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
