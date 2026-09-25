import { TrayIcon } from "@phosphor-icons/react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { ChoiceSelect, Empty } from "@/components/admin-form";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import { adminApplicationsListQueryKey, refreshAfter } from "@/lib/queries";

type ApplicationKind = "founder" | "contributor" | "client";
type ApplicationStatus = "new" | "reviewing" | "accepted" | "declined" | "converted";

type Application = Awaited<ReturnType<ApiClient["applications"]["list"]>>["data"][number];

export function ApplicationsAdminSection() {
  const apiClient = useApiClient();
  const [filterKind, setFilterKind] = useState<ApplicationKind | "">("");
  const [filterStatus, setFilterStatus] = useState<ApplicationStatus | "">("new");

  const applicationsQuery = useInfiniteQuery({
    queryKey: adminApplicationsListQueryKey(filterKind || null, filterStatus || null),
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

  const apps = useMemo(
    () => applicationsQuery.data?.pages.flatMap((p) => p.data) ?? [],
    [applicationsQuery.data],
  );

  if (applicationsQuery.isError) {
    if (isForbidden(applicationsQuery.error)) {
      return (
        <Empty
          icon={<TrayIcon aria-hidden />}
          label="Applications are reviewed by the MultiAgency team."
        />
      );
    }
    return <AdminError error={applicationsQuery.error} />;
  }

  const filtersActive = filterKind !== "" || filterStatus !== "new";

  const columns: ColumnDef<Application>[] = [
    {
      id: "name",
      header: "Name",
      accessorKey: "name",
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{row.original.name}</span>
          <span className="text-muted-foreground break-all">{row.original.email}</span>
          {row.original.nearAccountId && (
            <span className="text-muted-foreground">{row.original.nearAccountId}</span>
          )}
        </div>
      ),
    },
    {
      id: "message",
      header: "Message",
      accessorKey: "message",
      cell: ({ row }) => (
        <span className="line-clamp-2 max-w-xs whitespace-normal text-muted-foreground">
          {row.original.message ?? "—"}
        </span>
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
        <span className="text-muted-foreground tabular-nums">
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
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Applications</h2>
        </CardTitle>
        <CardDescription>
          Founder, builder and client applications from the public site.
        </CardDescription>
        <CardAction>
          <Badge variant="secondary">{apps.length}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-40">
            <ChoiceSelect
              id="filter-kind"
              ariaLabel="Kind"
              size="sm"
              value={filterKind}
              onValueChange={(value) => setFilterKind(value as ApplicationKind | "")}
              emptyLabel="All kinds"
              options={[
                { value: "founder", label: "Founder" },
                { value: "contributor", label: "Contributor" },
                { value: "client", label: "Client" },
              ]}
            />
          </div>
          <div className="w-40">
            <ChoiceSelect
              id="filter-status"
              ariaLabel="Status"
              size="sm"
              value={filterStatus}
              onValueChange={(value) => setFilterStatus(value as ApplicationStatus | "")}
              emptyLabel="All statuses"
              options={[
                { value: "new", label: "New" },
                { value: "reviewing", label: "Reviewing" },
                { value: "accepted", label: "Accepted" },
                { value: "declined", label: "Declined" },
                { value: "converted", label: "Converted" },
              ]}
            />
          </div>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilterKind("");
                setFilterStatus("new");
              }}
            >
              Reset filters
            </Button>
          )}
        </div>

        <DataTable
          columns={columns}
          data={apps}
          isLoading={applicationsQuery.isLoading}
          error={applicationsQuery.error}
          onRetry={() => applicationsQuery.refetch()}
          emptyMessage={
            filtersActive ? "No applications match these filters" : "No applications yet"
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
              {applicationsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function isForbidden(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "FORBIDDEN"
  );
}

function ApplicationActions({ application }: { application: Application }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: async (status: ApplicationStatus) =>
      apiClient.applications.update({ id: application.id, status }),
    onSuccess: async () => {
      await refreshAfter(queryClient, { type: "applications" });
      toast.success("Status updated");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to update status"),
  });

  const convertMutation = useMutation({
    mutationFn: async () => apiClient.applications.convertToBuilder({ id: application.id }),
    onSuccess: async () => {
      await refreshAfter(queryClient, { type: "applications" }, { type: "builders" });
      toast.success("Converted to builder");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to convert"),
  });

  return (
    <div className="flex justify-end gap-1">
      {application.kind === "contributor" &&
        application.status === "accepted" &&
        application.nearAccountId && (
          <Button
            size="sm"
            variant="default"
            onClick={() => convertMutation.mutate()}
            disabled={convertMutation.isPending}
          >
            {convertMutation.isPending ? "Converting…" : "Convert to builder"}
          </Button>
        )}
      {application.status === "converted" && <Badge variant="secondary">converted</Badge>}
      {transitionsFor(application.status).map((t) => (
        <Button
          key={t.to}
          variant={t.variant}
          size="sm"
          onClick={() => updateMutation.mutate(t.to)}
          disabled={updateMutation.isPending || application.status === "converted"}
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
  variant: "default" | "outline" | "ghost" | "destructive";
}[] {
  switch (status) {
    case "new":
      return [
        { to: "reviewing", label: "Review", variant: "outline" },
        { to: "accepted", label: "Accept", variant: "default" },
        { to: "declined", label: "Decline", variant: "destructive" },
      ];
    case "reviewing":
      return [
        { to: "accepted", label: "Accept", variant: "default" },
        { to: "declined", label: "Decline", variant: "destructive" },
        { to: "new", label: "Reset", variant: "ghost" },
      ];
    case "accepted":
      return [
        { to: "reviewing", label: "Reopen", variant: "outline" },
        { to: "declined", label: "Decline", variant: "destructive" },
      ];
    case "declined":
      return [
        { to: "reviewing", label: "Reopen", variant: "outline" },
        { to: "accepted", label: "Accept", variant: "default" },
      ];
    case "converted":
      return [];
  }
}
