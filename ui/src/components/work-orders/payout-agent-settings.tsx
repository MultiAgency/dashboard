import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldGroup,
  Input,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { Field, Loading } from "@/components/admin-form";
import { useMeRoles } from "@/hooks/use-me-roles";
import { type ApiClient, useApiClient } from "@/lib/api";
import { useAuthClient } from "@/lib/auth";
import { signAgentIntent } from "@/lib/payout-agent-signing";
import { payoutAgentQueryKey, payoutAgentQueryOptions } from "@/lib/queries";

type PayoutAgent = Awaited<ReturnType<ApiClient["workOrders"]["payoutAgent"]>>;
type Action = "create_agent" | "issue_grant" | "sync_policy" | "freeze" | "unfreeze";

const DONE: Record<Action, string> = {
  create_agent: "Payout agent created",
  issue_grant: "MultiAgency can now pay within your rules",
  sync_policy: "Updated rules signed",
  freeze: "Payouts frozen",
  unfreeze: "Payouts resumed",
};

function proposalIdOf(outcome: unknown): string | null {
  const status = (outcome as { status?: { SuccessValue?: unknown } } | null)?.status;
  if (typeof status?.SuccessValue !== "string" || !status.SuccessValue) return null;
  try {
    const value = JSON.parse(atob(status.SuccessValue));
    return Number.isInteger(value) ? String(value) : null;
  } catch {
    return null;
  }
}

export function PayoutAgentSettings() {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const { agencyDao } = useMeRoles();
  const query = useQuery(payoutAgentQueryOptions(apiClient));
  const [form, setForm] = useState<{ owner: string; budget: string; cap: string } | null>(null);
  const [topUp, setTopUp] = useState("");

  const setData = (data: PayoutAgent) =>
    queryClient.setQueryData(payoutAgentQueryOptions(apiClient).queryKey, data);

  const save = useMutation({
    mutationFn: (values: { owner: string; budget: string; cap: string }) =>
      apiClient.workOrders.savePayoutAgent({
        ownerAccountId: values.owner.trim(),
        monthlyBudgetUsd: values.budget.trim(),
        maxPayoutNear: values.cap.trim(),
      }),
    onSuccess: (data) => {
      setData(data);
      setForm(null);
      toast.success("Payout settings saved");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't save"),
  });

  const act = useMutation({
    mutationFn: async (action: Action) => {
      const owner = query.data?.settings?.ownerAccountId;
      if (!owner) throw new Error("Save the payout settings first");
      const prepared = await apiClient.workOrders.preparePayoutAction({ action });
      const signedData = await signAgentIntent(authClient, prepared.intent, owner);
      return apiClient.workOrders.submitPayoutAction({
        correlationId: prepared.correlationId,
        signedData,
      });
    },
    onSuccess: async (result, action) => {
      setData(result.view);
      await queryClient.invalidateQueries({ queryKey: payoutAgentQueryKey });
      if (result.status === "SUCCESS") toast.success(DONE[action]);
      else toast.info(`Sent; the Agent API says ${result.status.toLowerCase().replace(/_/g, " ")}`);
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't complete it"),
  });

  const fund = useMutation({
    mutationFn: async () => {
      const tx = await apiClient.workOrders.payoutTopUp({ amountNear: topUp.trim() });
      await authClient.near.ensureConnected();
      const signer = authClient.near.getAccountId();
      if (!signer) throw new Error("Connect your NEAR wallet first");
      const outcome = await authClient.near
        .getNearClient()
        .transaction(signer)
        .functionCall(tx.daoAccountId, tx.method, tx.args, {
          gas: tx.gas as `${number}`,
          attachedDeposit: BigInt(tx.deposit),
        })
        .send({ waitUntil: "FINAL" });
      return { id: proposalIdOf(outcome), dao: tx.daoAccountId, address: tx.address };
    },
    onSuccess: ({ id, dao }) => {
      setTopUp("");
      toast.success(
        id
          ? `Top-up proposal #${id} created in ${dao}; it funds the agent once the DAO approves it`
          : "Top-up proposal created; it funds the agent once the DAO approves it",
      );
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't create the top-up proposal"),
  });

  if (query.isLoading) return <Loading label="Loading automatic payouts" />;
  if (query.isError || !query.data) return <AdminError error={query.error} />;
  const data = query.data;
  const values = form ?? {
    owner: data.settings?.ownerAccountId ?? "",
    budget: data.settings?.monthlyBudgetUsd ?? "",
    cap: data.settings?.maxPayoutNear ?? "",
  };
  const busy = act.isPending || save.isPending || fund.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Automatic payouts (NEAR Intents)</h2>
        </CardTitle>
        <CardDescription>
          Approving a compensation request pays the builder in NEAR right away, through a payout
          agent you own. It can only pay builders of your active work orders, up to a cap per payout
          and a monthly budget, under rules you sign with your wallet. The DAO funds it with top-up
          proposals.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {!data.available ? (
          <Alert>
            <AlertTitle>Not set up on this server</AlertTitle>
            <AlertDescription>{data.unavailableReason}</AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant={data.ready ? "outline" : "secondary"}>
                {data.ready ? "Paying automatically" : "Not paying automatically yet"}
              </Badge>
              {data.policy?.frozen && <Badge variant="destructive">Frozen</Badge>}
              {data.policy?.monthlySpentUsd && (
                <Badge variant="outline">
                  ${data.policy.monthlySpentUsd} of ${data.policy.monthlyLimitUsd ?? "?"} this month
                </Badge>
              )}
            </div>
            {data.blockers.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-muted-foreground">
                {data.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            {data.error && <p className="text-sm text-destructive">{data.error}</p>}

            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(values);
              }}
            >
              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-3 sm:items-start">
                  <Field
                    label="Owner (NEAR account)"
                    htmlFor="payout-owner"
                    helper="Signs the rules. Can't change once the agent exists."
                  >
                    <Input
                      id="payout-owner"
                      value={values.owner}
                      disabled={!!data.agentId}
                      onChange={(e) => setForm({ ...values, owner: e.target.value })}
                    />
                  </Field>
                  <Field label="Monthly budget (USD)" htmlFor="payout-budget">
                    <Input
                      id="payout-budget"
                      inputMode="decimal"
                      value={values.budget}
                      onChange={(e) => setForm({ ...values, budget: e.target.value })}
                    />
                  </Field>
                  <Field label="Max per payout (NEAR)" htmlFor="payout-cap">
                    <Input
                      id="payout-cap"
                      inputMode="decimal"
                      value={values.cap}
                      onChange={(e) => setForm({ ...values, cap: e.target.value })}
                    />
                  </Field>
                </div>
              </FieldGroup>
              <Button type="submit" size="sm" className="self-start" disabled={busy}>
                Save
              </Button>
            </form>

            {data.settings && (
              <div className="flex flex-col gap-3 border-t pt-4">
                <span className="text-sm font-medium">
                  With your wallet ({data.settings.ownerAccountId})
                </span>
                <div className="flex flex-wrap gap-2">
                  {!data.agentId && (
                    <Button size="sm" disabled={busy} onClick={() => act.mutate("create_agent")}>
                      Create the payout agent
                    </Button>
                  )}
                  {data.agentId && !data.grantValid && (
                    <Button size="sm" disabled={busy} onClick={() => act.mutate("issue_grant")}>
                      Let MultiAgency pay within the rules
                    </Button>
                  )}
                  {data.agentId && data.changes.length > 0 && (
                    <Button size="sm" disabled={busy} onClick={() => act.mutate("sync_policy")}>
                      Sign the updated rules
                    </Button>
                  )}
                  {data.policy && !data.policy.frozen && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => act.mutate("freeze")}
                    >
                      Freeze payouts
                    </Button>
                  )}
                  {data.policy?.frozen && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => act.mutate("unfreeze")}
                    >
                      Resume payouts
                    </Button>
                  )}
                </div>
                {data.changes.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    The signed rules differ: {data.changes.join("; ")}.
                  </p>
                )}
                {data.policy && (
                  <p className="text-sm text-muted-foreground">
                    Allowed builders:{" "}
                    {data.policy.payees.length ? data.policy.payees.join(", ") : "none yet"}.
                  </p>
                )}
              </div>
            )}

            {data.agentId && agencyDao && (
              <form
                className="flex flex-col gap-2 border-t pt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (/^\d+(\.\d+)?$/.test(topUp.trim())) fund.mutate();
                }}
              >
                <Field
                  label="Top up the agent from the DAO (NEAR)"
                  htmlFor="payout-topup"
                  helper={`Creates a transfer proposal in ${agencyDao} to the agent's deposit address. Try a small amount first.`}
                >
                  <Input
                    id="payout-topup"
                    inputMode="decimal"
                    placeholder="e.g. 100"
                    value={topUp}
                    onChange={(e) => setTopUp(e.target.value)}
                  />
                </Field>
                <Button
                  type="submit"
                  size="sm"
                  className="self-start"
                  disabled={busy || !/^\d+(\.\d+)?$/.test(topUp.trim())}
                >
                  {fund.isPending ? "Waiting for the wallet…" : "Create the top-up proposal"}
                </Button>
              </form>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
