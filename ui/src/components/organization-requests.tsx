import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Textarea,
} from "@/components";
import { LoadError } from "@/components/load-error";
import { useApiClient } from "@/lib/api";
import { organizationRequestsQueryKey, organizationRequestsQueryOptions } from "@/lib/queries";

type OrganizationRequest = {
  id: string;
  name: string;
  slug: string;
  requestedBy: string | null;
  requestedByEmail: string | null;
  requestedAt: string;
};

export function OrganizationRequests({ onReviewed }: { onReviewed: () => void }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const requestsQuery = useQuery(organizationRequestsQueryOptions(apiClient));
  const [approving, setApproving] = useState<OrganizationRequest | null>(null);
  const [rejecting, setRejecting] = useState<OrganizationRequest | null>(null);
  const requests = requestsQuery.data?.data ?? [];

  const reviewed = () => {
    queryClient.invalidateQueries({ queryKey: organizationRequestsQueryKey });
    onReviewed();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Pending approval</h2>
        </CardTitle>
        <CardDescription>
          New Organizations can't be opened or invite anyone until a site admin approves them.
        </CardDescription>
        <CardAction>
          <Badge variant="secondary">{requests.length}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {requestsQuery.isError ? (
          <LoadError
            title="Could not load pending Organizations"
            description={requestsQuery.error?.message || "Check your connection and try again."}
            onRetry={() => requestsQuery.refetch()}
          />
        ) : requestsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing waiting.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {requests.map((request) => (
              <li
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium break-words">{request.name}</p>
                  <p className="text-sm text-muted-foreground break-words">
                    {request.slug} · asked by{" "}
                    {request.requestedByEmail ?? request.requestedBy ?? "unknown"} ·{" "}
                    {new Date(request.requestedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setRejecting(request)}>
                    Reject
                  </Button>
                  <Button size="sm" onClick={() => setApproving(request)}>
                    Approve
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ApproveDialog request={approving} onClose={() => setApproving(null)} onReviewed={reviewed} />
      <RejectDialog request={rejecting} onClose={() => setRejecting(null)} onReviewed={reviewed} />
    </Card>
  );
}

function ApproveDialog({
  request,
  onClose,
  onReviewed,
}: {
  request: OrganizationRequest | null;
  onClose: () => void;
  onReviewed: () => void;
}) {
  const apiClient = useApiClient();
  const [daoAccountId, setDaoAccountId] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  const close = () => {
    setDaoAccountId("");
    setAdminEmail("");
    onClose();
  };

  const approve = useMutation({
    mutationFn: async (organization: OrganizationRequest) => {
      const email = adminEmail.trim();
      const { adminInvite } = await apiClient.organizationRequests.review({
        organizationId: organization.id,
        decision: "approve",
        ...(email ? { adminEmail: email } : {}),
      });
      const dao = daoAccountId.trim();
      const daoError = dao
        ? await apiClient.agencyDao
            .connect({ daoAccountId: dao, organizationId: organization.id })
            .then(() => null)
            .catch((e: Error) => e.message || "Failed to connect the Agency DAO")
        : null;
      const inviteError = adminInvite?.status === "failed" ? adminInvite.message : null;
      return { organization, daoError, inviteError };
    },
    onSuccess: ({ organization, daoError, inviteError }) => {
      if (daoError) {
        toast.warning(
          `"${organization.name}" was approved, but its Agency DAO was not connected: ${daoError}`,
        );
      }
      if (inviteError) {
        toast.warning(
          `"${organization.name}" was approved, but the admin invite failed: ${inviteError}`,
        );
      }
      if (!daoError && !inviteError) toast.success(`"${organization.name}" approved`);
      onReviewed();
      close();
    },
    onError: (e: Error) => toast.error(e.message || "Could not approve the Organization"),
  });

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && !approve.isPending && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve {request?.name}?</DialogTitle>
          <DialogDescription>
            Its members can open it and invite others once it's approved.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="approve-dao">Agency DAO</FieldLabel>
            <Input
              id="approve-dao"
              autoComplete="off"
              value={daoAccountId}
              onChange={(e) => setDaoAccountId(e.target.value)}
              placeholder="Optional, e.g. your-org.sputnik-dao.near"
              disabled={approve.isPending}
            />
            <FieldDescription>
              A Sputnik DAO for money features. It must exist on the current network.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="approve-admin-email">Agency admin email</FieldLabel>
            <Input
              id="approve-admin-email"
              type="email"
              autoComplete="off"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="Optional, admin@example.com"
              disabled={approve.isPending}
            />
            <FieldDescription>Invited as admin once the Organization is approved.</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={approve.isPending}>
            Cancel
          </Button>
          <Button onClick={() => request && approve.mutate(request)} disabled={approve.isPending}>
            {approve.isPending ? "Approving…" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  request,
  onClose,
  onReviewed,
}: {
  request: OrganizationRequest | null;
  onClose: () => void;
  onReviewed: () => void;
}) {
  const apiClient = useApiClient();
  const [reason, setReason] = useState("");

  const close = () => {
    setReason("");
    onClose();
  };

  const reject = useMutation({
    mutationFn: (organization: OrganizationRequest) =>
      apiClient.organizationRequests.review({
        organizationId: organization.id,
        decision: "reject",
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success(`"${request?.name}" rejected`);
      onReviewed();
      close();
    },
    onError: (e: Error) => toast.error(e.message || "Could not reject the Organization"),
  });

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && !reject.isPending && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject {request?.name}?</DialogTitle>
          <DialogDescription>
            It stays unusable. The person who asked sees the reason.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="reject-reason">Reason</FieldLabel>
          <Textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={reject.isPending}
            required
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={reject.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => request && reject.mutate(request)}
            disabled={reject.isPending || !reason.trim()}
          >
            {reject.isPending ? "Rejecting…" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
