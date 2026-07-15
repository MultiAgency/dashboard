import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, DataTable, Input } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Field, selectClass } from "@/components/admin-form";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import { isValidNearAccountId } from "@/lib/near-account";
import { adminContributorsListQueryKey, adminContributorsListQueryOptions } from "@/lib/queries";

type OnboardingStatus = "pending" | "complete" | "expired";

type Contributor = Awaited<ReturnType<ApiClient["contributors"]["list"]>>["data"][number];

export function ContributorsAdminSection() {
  const apiClient = useApiClient();
  const contributorsQuery = useQuery(adminContributorsListQueryOptions(apiClient));
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (contributorsQuery.isError) {
    return <AdminError error={contributorsQuery.error} />;
  }

  const columns: ColumnDef<Contributor>[] = [
    {
      id: "name",
      header: "Name",
      accessorKey: "name",
      cell: ({ row }) => (
        <span className="font-display text-sm uppercase tracking-tight font-bold">
          {row.original.name}
        </span>
      ),
    },
    {
      id: "nearAccountId",
      header: "NEAR",
      accessorKey: "nearAccountId",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.nearAccountId ?? "—"}
        </span>
      ),
    },
    {
      id: "email",
      header: "Email",
      accessorKey: "email",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.email ?? "—"}</span>
      ),
    },
    {
      id: "onboardingStatus",
      header: "Onboarding",
      accessorKey: "onboardingStatus",
      cell: ({ row }) => (
        <Badge variant={row.original.onboardingStatus === "complete" ? "default" : "outline"}>
          {row.original.onboardingStatus}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSelectedId((s) => (s === row.original.id ? null : row.original.id))}
        >
          {selectedId === row.original.id ? "close" : "edit"}
        </Button>
      ),
    },
  ];

  const selected = contributorsQuery.data?.data.find((c) => c.id === selectedId);

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

      <DataTable
        columns={columns}
        data={contributorsQuery.data?.data ?? []}
        isLoading={contributorsQuery.isLoading}
        error={contributorsQuery.error}
        onRetry={() => contributorsQuery.refetch()}
        emptyMessage="No contributors yet. Create your first one above."
        csvFilename="contributors"
        viewId="admin-contributors"
        searchPlaceholder="Search contributors…"
      />

      {selected && (
        <Card>
          <CardContent className="p-5">
            <ContributorEditForm contributor={selected} />
          </CardContent>
        </Card>
      )}
    </div>
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
  const nearTrimmed = nearAccountId.trim();
  const nearOk = !nearTrimmed || isValidNearAccountId(nearTrimmed);
  const canSubmit = name.trim().length > 0 && nearOk && !isPending;

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
          <Field label="email (optional)" htmlFor="new-email">
            <Input
              id="new-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isPending}
            />
          </Field>
          <Field
            label="near account (optional)"
            htmlFor="new-near"
            helper="Lowercase NEAR account id when set."
          >
            <Input
              id="new-near"
              value={nearAccountId}
              onChange={(e) => setNearAccountId(e.target.value)}
              placeholder="contributor.near"
              disabled={isPending}
            />
            {nearTrimmed && !nearOk && (
              <p className="text-xs text-destructive">Invalid NEAR account id</p>
            )}
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
  const nearTrimmed = nearAccountId.trim();
  const nearOk = !nearTrimmed || isValidNearAccountId(nearTrimmed);
  const canSubmit = name.trim().length > 0 && nearOk && !isPending;

  return (
    <div className="grid gap-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        edit · {contributor.name}
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
        <Field label="email (optional)" htmlFor={`edit-email-${contributor.id}`}>
          <Input
            id={`edit-email-${contributor.id}`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isPending}
          />
        </Field>
        <Field label="near account (optional)" htmlFor={`edit-near-${contributor.id}`}>
          <Input
            id={`edit-near-${contributor.id}`}
            value={nearAccountId}
            onChange={(e) => setNearAccountId(e.target.value)}
            disabled={isPending}
          />
          {nearTrimmed && !nearOk && (
            <p className="text-xs text-destructive">Invalid NEAR account id</p>
          )}
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
        <Button onClick={() => updateMutation.mutate()} disabled={!canSubmit} size="sm">
          {isPending ? "saving..." : "save changes"}
        </Button>
      </div>
    </div>
  );
}
