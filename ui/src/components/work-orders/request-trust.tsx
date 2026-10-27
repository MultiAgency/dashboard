import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge, Button } from "@/components";
import { useApiClient } from "@/lib/api";
import { relativeTime } from "@/lib/format-date";
import { adminWorkOrdersQueryKey } from "@/lib/queries";
import type { CompensationRequest } from "./work-order-status";

type Trust = NonNullable<CompensationRequest["trust"]>;

const TIERS: Record<
  Trust["tier"],
  { label: string; variant: "outline" | "secondary" | "default" }
> = {
  new: { label: "New builder", variant: "secondary" },
  established: { label: "Established builder", variant: "outline" },
  trusted: { label: "Trusted builder", variant: "default" },
};

const VERDICTS: Record<NonNullable<Trust["aiVerdict"]>, string> = {
  consistent: "The AI check found the report consistent with the evidence.",
  concerns: "The AI check has concerns about the report.",
  inconsistent: "The AI check found the report inconsistent with the evidence.",
};

const SUGGESTIONS: Record<Trust["suggested"], string> = {
  manual: "an admin approves it",
  veto_window: "it would be approved after a window you can stop",
  auto_pay: "it would be approved and paid right away",
};

export function RequestTrust({
  request,
  canManage,
}: {
  request: CompensationRequest;
  canManage: boolean;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const stop = useMutation({
    mutationFn: () => apiClient.workOrders.stopAutoApproval({ requestId: request.id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminWorkOrdersQueryKey });
      toast.success(`${request.code} now waits for your approval`);
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't stop the approval"),
  });
  const trust = request.trust;
  if (!trust) return null;
  const tier = TIERS[trust.tier];

  if (trust.approvedAutomatically) {
    return <p className="text-sm text-muted-foreground">Approved automatically ({tier.label}).</p>;
  }
  if (request.status !== "submitted") return null;

  return (
    <div className="flex flex-col gap-2 border bg-muted/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={tier.variant}>{tier.label}</Badge>
        <span className="text-muted-foreground tabular-nums">Trust score {trust.score}</span>
        {trust.stopped && <Badge variant="outline">Automatic approval stopped</Badge>}
      </div>
      {trust.blockers.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="font-medium">Needs your approval because:</span>
          <ul className="list-disc pl-5 text-muted-foreground">
            {trust.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {trust.aiVerdict && (
        <p className={trust.aiVerdict === "consistent" ? "text-muted-foreground" : "font-medium"}>
          {VERDICTS[trust.aiVerdict]}
        </p>
      )}
      {trust.aiConcerns.length > 0 && (
        <ul className="list-disc pl-5 text-muted-foreground">
          {trust.aiConcerns.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      {trust.decision === "manual" && trust.suggested !== "manual" && !trust.stopped && (
        <p className="text-muted-foreground">
          With automatic approval on, {SUGGESTIONS[trust.suggested]}.
        </p>
      )}
      <ul className="list-disc pl-5 text-xs text-muted-foreground">
        {trust.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {trust.autoApproveAt && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            Approves automatically{" "}
            <time dateTime={trust.autoApproveAt} title={trust.autoApproveAt}>
              {relativeTime(trust.autoApproveAt)}
            </time>
          </span>
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              disabled={stop.isPending}
              onClick={() => stop.mutate()}
            >
              {stop.isPending ? "Stopping…" : "Stop"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
