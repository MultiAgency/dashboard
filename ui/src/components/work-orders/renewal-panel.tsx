import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useApiClient } from "@/lib/api";
import { adminWorkOrdersQueryKey } from "@/lib/queries";
import { RenewalBadge, type WorkOrder } from "./work-order-status";

export function RenewalPanel({
  workOrder,
  canManage,
}: {
  workOrder: WorkOrder;
  canManage: boolean;
}) {
  const renewal = workOrder.renewal;
  if (!renewal) {
    if (!workOrder.autoRenew || !["active", "ended", "exhausted"].includes(workOrder.status)) {
      return null;
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Monthly renewal</h2>
          </CardTitle>
          <CardDescription>
            Checked after {workOrder.periodEnd} + {workOrder.graceDays} grace days. If every base
            metric is met, next month's work order is sent for signature; otherwise you decide.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const { assessment } = renewal;
  const missed = assessment.metrics.filter((m) => !m.met).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Monthly renewal</h2>
        </CardTitle>
        <CardDescription>
          {assessment.periodStart} → {assessment.periodEnd}, measured{" "}
          {assessment.assessedAt.slice(0, 10)}:{" "}
          {assessment.passed
            ? "every base metric met."
            : `${missed} of ${assessment.metrics.length} base metrics missed.`}
        </CardDescription>
        <CardAction>
          <RenewalBadge status={renewal.status} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Metric</TableHead>
              <TableHead scope="col">This period</TableHead>
              <TableHead scope="col">Needed</TableHead>
              <TableHead scope="col">
                <span className="sr-only">Result</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assessment.metrics.map((m) => (
              <TableRow key={m.key}>
                <TableCell
                  className={
                    m.met ? "whitespace-normal" : "whitespace-normal font-medium text-destructive"
                  }
                >
                  {m.label}
                </TableCell>
                <TableCell className="whitespace-normal tabular-nums">{m.value}</TableCell>
                <TableCell className="text-muted-foreground">{m.target}</TableCell>
                <TableCell className={m.met ? "text-muted-foreground" : "text-destructive"}>
                  {m.met ? "Met" : "Missed"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {renewal.status === "renewed" && renewal.renewedTo && (
          <p className="text-sm">
            {renewal.decidedBy === "auto"
              ? "Renewed automatically"
              : "Renewed by the representative"}{" "}
            as{" "}
            <Link
              to="/admin/work-orders/$id"
              params={{ id: renewal.renewedTo }}
              className="font-medium underline underline-offset-4"
            >
              next month's work order
            </Link>
            {renewal.note ? `. Note: ${renewal.note}` : "."}
          </p>
        )}
        {renewal.status === "declined" && (
          <p className="text-sm text-muted-foreground">
            Not renewed{renewal.note ? `. Note: ${renewal.note}` : "."}
          </p>
        )}
        {renewal.status === "needs_approval" && canManage && (
          <DecideRenewal workOrder={workOrder} />
        )}
      </CardContent>
    </Card>
  );
}

function DecideRenewal({ workOrder }: { workOrder: WorkOrder }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);
  const decide = useMutation({
    mutationFn: (decision: "approve" | "decline") =>
      apiClient.workOrders.decideRenewal({ id: workOrder.id, decision, note: note.trim() || null }),
    onSuccess: async (_, decision) => {
      await queryClient.invalidateQueries({ queryKey: adminWorkOrdersQueryKey });
      toast.success(
        decision === "approve" ? `${workOrder.code} renewed` : `${workOrder.code} won't be renewed`,
      );
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't record the decision"),
  });
  return (
    <Alert>
      <AlertTitle>Renewal needs your decision</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>
          Renew to send next month's work order for signature, or let {workOrder.code} end here. The
          builder is told either way.
        </span>
        <Input
          aria-label="Note (optional)"
          placeholder="Note (optional, kept with the decision)"
          value={note}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate("approve")}>
            Approve renewal
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={decide.isPending}
            onClick={() => setDeclining(true)}
          >
            Don't renew
          </Button>
        </div>
        <ConfirmDialog
          open={declining}
          onOpenChange={setDeclining}
          title={`Let ${workOrder.code} end without renewing?`}
          description="No work order starts next month and the builder is told. This can't be undone here."
          confirmLabel="Don't renew"
          destructive
          onConfirm={() => decide.mutateAsync("decline").then(() => undefined)}
        />
      </AlertDescription>
    </Alert>
  );
}
