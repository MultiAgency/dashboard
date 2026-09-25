import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, Input } from "@/components";
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
      <CardContent className="p-5 space-y-4">
        {connected ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm break-all">{connected}</span>
              <Badge variant="outline">{network}</Badge>
              <a
                href={trezuTreasuryUrl(connected)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs underline text-muted-foreground hover:text-foreground"
              >
                open in trezu <ArrowUpRightIcon className="size-3" />
              </a>
            </div>
            {inUse ? (
              <p className="text-xs text-muted-foreground">
                This Agency DAO funds Budget entries or Billings of your Projects, so it cannot be
                changed or disconnected.
              </p>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setChanging((v) => !v)}
                >
                  {changing ? "cancel" : "change"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmingDisconnect(true)}
                >
                  disconnect
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No Agency DAO is connected. Budgets, Billings and treasury views need one. Projects,
            members and reports work without it.
          </p>
        )}

        {showForm && (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (daoAccountId.trim() && !busy) connect.mutate();
            }}
          >
            <Field
              label="sputnik dao account"
              htmlFor="agency-dao-account"
              helper={
                <>
                  Must exist on {network}, and your linked NEAR wallet must hold a role in it. A
                  single-member treasury from{" "}
                  <a
                    href="https://trezu.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
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
                  network === "testnet" ? "your-org.sputnikv2.testnet" : "your-org.sputnik-dao.near"
                }
                autoComplete="off"
                disabled={busy}
              />
            </Field>
            <Button type="submit" size="sm" disabled={!daoAccountId.trim() || busy}>
              {connect.isPending ? "connecting..." : "connect treasury"}
            </Button>
          </form>
        )}

        <ConfirmDialog
          open={confirmingDisconnect}
          onOpenChange={setConfirmingDisconnect}
          title="Disconnect the Agency DAO?"
          description="Budgets, Billings and treasury views stop working until you connect another one."
          confirmLabel="disconnect"
          destructive
          onConfirm={() => disconnect.mutate()}
        />
      </CardContent>
    </Card>
  );
}
