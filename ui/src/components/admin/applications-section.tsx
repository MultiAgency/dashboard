import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, DataTable } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Field, selectClass } from "@/components/admin-form";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";

type ApplicationKind = "founder" | "contributor" | "client";
type ApplicationStatus = "new" | "reviewing" | "accepted" | "declined";

type Application = Awaited<ReturnType<ApiClient["applications"]["list"]>>["data"][number];

export function ApplicationsAdminSection() {
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

  const apps = useMemo(
    () => applicationsQuery.data?.pages.flatMap((p) => p.data) ?? [],
    [applicationsQuery.data],
  );
  const filtersActive = filterKind !== "" || filterStatus !== "new";

  const columns: ColumnDef<Application>[] = [
    {
      id: "name",
      header: "Name",
      accessorKey: "name",
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <div className="font-display text-sm uppercase tracking-tight font-bold">
            {row.original.name}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground break-all">
            {row.original.email}
          </div>
        </div>
      ),
    },
    {
      id: "kind",
      header: "Kind",
      accessorKey: "kind",
      cell: ({ row }) => <Badge variant="outline">{row.original.kind}</Badge>,
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      cell: ({ row }) => (
        <Badge variant={row.original.status === "new" ? "default" : "outline"}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      id: "createdAt",
      header: "Created",
      accessorFn: (row) => new Date(row.createdAt).toISOString(),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {new Date(row.original.createdAt).toISOString().slice(0, 10)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => <ApplicationActions application={row.original} />,
    },
  ];

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

      <DataTable
        columns={columns}
        data={apps}
        isLoading={applicationsQuery.isLoading}
        error={applicationsQuery.error}
        onRetry={() => applicationsQuery.refetch()}
        emptyMessage={
          filtersActive
            ? "No applications match the current filters."
            : "No applications submitted yet."
        }
        csvFilename="applications"
        viewId="admin-applications"
        searchPlaceholder="Search applications…"
      />

      {applicationsQuery.hasNextPage && (
        <div className="flex justify-center">
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
    </div>
  );
}

function ApplicationActions({ application }: { application: Application }) {
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

  return (
    <div className="flex flex-wrap gap-1 justify-end">
      {transitionsFor(application.status).map((t) => (
        <Button
          key={t.to}
          variant={t.variant}
          size="sm"
          onClick={() => updateMutation.mutate(t.to)}
          disabled={updateMutation.isPending}
        >
          {t.label}
        </Button>
      ))}
    </div>
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
        { to: "reviewing", label: "review", variant: "default" },
        { to: "accepted", label: "accept", variant: "default" },
        { to: "declined", label: "decline", variant: "destructive" },
      ];
    case "reviewing":
      return [
        { to: "accepted", label: "accept", variant: "default" },
        { to: "declined", label: "decline", variant: "destructive" },
        { to: "new", label: "reset", variant: "outline" },
      ];
    case "accepted":
      return [
        { to: "reviewing", label: "reopen", variant: "outline" },
        { to: "declined", label: "decline", variant: "destructive" },
      ];
    case "declined":
      return [
        { to: "reviewing", label: "reopen", variant: "outline" },
        { to: "accepted", label: "accept", variant: "default" },
      ];
  }
}
