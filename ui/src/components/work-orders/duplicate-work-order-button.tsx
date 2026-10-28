import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Dialog, DialogContent } from "@/components";
import { WorkOrderForm } from "./work-order-form";
import type { WorkOrder } from "./work-order-status";

export function DuplicateWorkOrderButton({
  workOrder,
  variant = "outline",
  className,
}: {
  workOrder: WorkOrder;
  variant?: "outline" | "ghost" | "secondary";
  className?: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant={variant} className={className} onClick={() => setOpen(true)}>
        Duplicate
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
          onInteractOutside={(event) => event.preventDefault()}
        >
          {open && (
            <WorkOrderForm
              template={workOrder}
              onDone={(created) => {
                setOpen(false);
                void navigate({ to: "/admin/work-orders/$id", params: { id: created.id } });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
