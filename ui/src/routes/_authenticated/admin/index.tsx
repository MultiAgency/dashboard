import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button, Dialog, DialogContent, PageHeader } from "@/components";
import { InProgressList, WaitingOnYouList } from "@/components/home/home-work-order-lists";
import { activeWorkOrders, waitingOnYou } from "@/components/home/home-work-orders";
import { SetupChecklist } from "@/components/work-orders/setup-checklist";
import { WorkOrderForm } from "@/components/work-orders/work-order-form";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { adminWorkOrdersQueryOptions, workOrderSetupQueryOptions } from "@/lib/queries";
import { setupSummary } from "@/lib/setup-status";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [{ title: "Home" }, { name: "description", content: "What needs you next." }],
  }),
  component: HomePage,
});

function HomePage() {
  const apiClient = useApiClient();
  const navigate = useNavigate();
  const { canAccessAdmin: canManage } = useMeRoles();
  const query = useQuery(adminWorkOrdersQueryOptions(apiClient));
  const setup = useQuery({ ...workOrderSetupQueryOptions(apiClient), enabled: canManage });
  const [creating, setCreating] = useState(false);

  const workOrders = query.data?.data ?? [];
  const waiting = useMemo(() => waitingOnYou(workOrders), [workOrders]);
  const active = useMemo(() => activeWorkOrders(workOrders), [workOrders]);
  const setupPending = canManage && !!setup.data && !setupSummary(setup.data).ready;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Home"
        actions={
          canManage && (
            <Button size="sm" onClick={() => setCreating(true)}>
              New work order
            </Button>
          )
        }
      />
      {setupPending && <SetupChecklist compact />}

      <WaitingOnYouList
        workOrders={waiting}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      />

      {!query.error && <InProgressList workOrders={active} />}

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
