import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  FieldGroup,
  Input,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { Field, Loading } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useApiClient } from "@/lib/api";
import { agencyDaoQueryOptions, invalidateWorkspaceQueries } from "@/lib/queries";
import { trezuTreasuryUrl } from "@/lib/trezu";

export function TreasurySettings() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const statusQuery = useQuery(agencyDaoQueryOptions(apiClient));
  const [daoAccountId, setDaoAccountId] = useState("");
  const [changing, setChanging] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const refresh = () => invalidateWorkspaceQueries(queryClient, router);

  const connect = useMutation({
    mutationFn: () => apiClient.agencyDao.connect({ daoAccountId: daoAccountId.trim() }),
    onSuccess: async ({ daoAccountId: connected }) => {
      toast.success(`Connected ${connected}`);
      setDaoAccountId("");
      setChanging(false);
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message || "Could not connect the Agency DAO"),
  });

  const disconnect = useMutation({
    mutationFn: () => apiClient.agencyDao.disconnect(),
    onSuccess: async () => {
      toast.success("Agency DAO disconnected");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message || "Could not disconnect the Agency DAO"),
  });

  if (statusQuery.isLoading) return <Loading label="Loading treasury..." />;
  if (statusQuery.isError || !statusQuery.data) return <AdminError error={statusQuery.error} />;

  const { daoAccountId: connected, network, inUse } = statusQuery.data;
  const showForm = !connected || changing;
  const busy = connect.isPending || disconnect.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Treasury</h2>
        </CardTitle>
        <CardDescription>
          {connected
            ? "The Agency DAO that funds Budgets and Billings of your Projects."
            : "No Agency DAO is connected. Budgets, Billings and treasury views need one; Projects, members and reports work without it."}
        </CardDescription>
        <CardAction>
          <Badge variant="outline">{network}</Badge>
        </CardAction>
      </CardHeader>

      {connected && (
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-medium break-all">{connected}</span>
            <Button asChild variant="link" size="xs">
              <a href={trezuTreasuryUrl(connected)} target="_blank" rel="noopener noreferrer">
                Open in Trezu
                <ArrowUpRightIcon data-icon="inline-end" aria-hidden />
              </a>
            </Button>
          </div>
          {inUse && (
            <p className="text-xs text-muted-foreground">
              This Agency DAO funds Budget entries or Billings of your Projects, so it cannot be
              changed or disconnected.
            </p>
          )}
        </CardContent>
      )}

      {showForm && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (daoAccountId.trim() && !busy) connect.mutate();
          }}
        >
          <CardContent>
            <FieldGroup>
              <Field
                label="Sputnik DAO account"
                htmlFor="agency-dao-account"
                helper={
                  <>
                    Must exist on {network}, and your linked NEAR wallet must hold a role in it. A
                    single-member treasury from{" "}
                    <a href="https://trezu.app" target="_blank" rel="noopener noreferrer">
                      Trezu
                    </a>{" "}
                    works.
                  </>
                }
              >
                <Input
                  id="agency-dao-account"
                  value={daoAccountId}
                  onChange={(e) => setDaoAccountId(e.target.value)}
                  placeholder={
                    network === "testnet"
                      ? "your-org.sputnikv2.testnet"
                      : "your-org.sputnik-dao.near"
                  }
                  autoComplete="off"
                  disabled={busy}
                />
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            {changing && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setChanging(false)}
              >
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={!daoAccountId.trim() || busy}>
              {connect.isPending ? "Connecting…" : "Connect treasury"}
            </Button>
          </CardFooter>
        </form>
      )}

      {connected && !inUse && !changing && (
        <CardFooter className="justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => setChanging(true)}>
            Change
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => setConfirmingDisconnect(true)}
          >
            Disconnect
          </Button>
        </CardFooter>
      )}

      <ConfirmDialog
        open={confirmingDisconnect}
        onOpenChange={setConfirmingDisconnect}
        title="Disconnect the Agency DAO?"
        description="Budgets, Billings and treasury views stop working until you connect another one."
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => disconnect.mutate()}
      />
    </Card>
  );
}
