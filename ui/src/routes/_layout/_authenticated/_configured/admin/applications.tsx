import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty, Field, Loading, selectClass } from "@/components/admin-form";
import { useApiClient } from "@/lib/api";

export const Route = createFileRoute("/_layout/_authenticated/_configured/admin/applications")({
  head: () => ({
    meta: [{ title: "Admin · Applications" }],
  }),
  component: AdminApplications,
});

type ApplicationKind = "replicate" | "contributor";
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

function AdminApplications() {
  const apiClient = useApiClient();
  const [filterKind, setFilterKind] = useState<ApplicationKind | "">("");
  const [filterStatus, setFilterStatus] = useState<ApplicationStatus | "">("new");

  const applicationsQuery = useInfiniteQuery({
    queryKey: ["admin", "applications", "list", filterKind || null, filterStatus || null],
    queryFn: ({ pageParam }) =>
      apiClient.applications.adminList({
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
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Applications</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Submissions from the public <span className="font-mono">/apply</span> form. Review the
          message and metadata, then transition status to track the review lifecycle. Submissions
          themselves are immutable.
        </p>
      </header>

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
              <option value="replicate">replicate</option>
              <option value="contributor">contributor</option>
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
        <Empty
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
      apiClient.applications.adminUpdate({ id: application.id, status }),
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
            <div className="font-semibold tracking-tight break-all">{application.name}</div>
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
