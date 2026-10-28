import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button, Dialog, DialogContent, PageHeader } from "@/components";
import { SetupChecklist } from "@/components/work-orders/setup-checklist";
import { WorkOrderForm } from "@/components/work-orders/work-order-form";
import { WorkOrdersInbox } from "@/components/work-orders/work-orders-inbox";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { adminWorkOrdersQueryOptions } from "@/lib/queries";
import { INBOX_VIEWS } from "@/lib/work-orders-inbox";

const workOrdersSearchSchema = z.object({
  view: z.enum(INBOX_VIEWS).optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/admin/work-orders/")({
  head: () => ({
    meta: [
      { title: "Work orders" },
      {
        name: "description",
        content:
          "Signed work orders: a period, a budget cap and the repositories in scope per builder.",
      },
    ],
  }),
  validateSearch: workOrdersSearchSchema,
  component: WorkOrdersPage,
});

function WorkOrdersPage() {
  const apiClient = useApiClient();
  const navigate = useNavigate();
  const { view } = Route.useSearch();
  const setSearch = Route.useNavigate();
  const { canAccessAdmin: canManage } = useMeRoles();
  const query = useQuery(adminWorkOrdersQueryOptions(apiClient));
  const [creating, setCreating] = useState(false);
  const newWorkOrder = canManage && (
    <Button size="sm" onClick={() => setCreating(true)}>
      New work order
    </Button>
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Work orders"
        description="A work order sets what a builder works on, for how long and up to what budget. Work counts once it's approved or merged on GitHub, and approved requests are paid by your payout agent or through your Agency DAO."
        actions={newWorkOrder}
      />
      {canManage && <SetupChecklist />}

      <WorkOrdersInbox
        workOrders={query.data?.data ?? []}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => query.refetch()}
        view={view}
        onViewChange={(next) => void setSearch({ search: { view: next }, replace: true })}
        emptyAction={newWorkOrder}
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
          onInteractOutside={(event) => event.preventDefault()}
        >
          {creating && (
            <WorkOrderForm
              onDone={(workOrder) => {
                setCreating(false);
                void navigate({ to: "/admin/work-orders/$id", params: { id: workOrder.id } });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
