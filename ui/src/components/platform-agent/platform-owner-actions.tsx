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
  Input,
} from "@/components";
import { Field } from "@/components/admin-form";
import { SigningText } from "@/components/platform-agent/signing-text";
import { type ApiClient, useApiClient } from "@/lib/api";
import { useAuthClient } from "@/lib/auth";
import { formatTokenAmount, tokenSymbol } from "@/lib/format-amount";
import { signAgentIntent } from "@/lib/payout-agent-signing";
import { platformAgentQueryKey, platformAgentReadKey } from "@/lib/queries";

type OwnerView = Awaited<ReturnType<ApiClient["platformAgent"]["ownerView"]>>;
type Prepared = Awaited<ReturnType<ApiClient["platformAgent"]["prepareAction"]>>;
type Kind = Parameters<ApiClient["platformAgent"]["prepareAction"]>[0]["kind"];
type Rules = NonNullable<OwnerView["rules"]>;
type Held = OwnerView["held"][number];
type Verdict = "approve" | "reject";

const ASSET_LABELS: Record<Rules["asset"], string> = {
  wnear: "wNEAR, withdrawn to each builder's NEAR account",
  usdc: "USDC, sent as a confidential transfer",
};
const decimal = /^\d+(\.\d{1,6})?$/;
const tokenOf = (asset: string) => asset.replace(/^nep141:/, "");
const amountOf = (amount: string | null, asset: string | null) =>
  amount && asset ? formatTokenAmount(amount, tokenOf(asset)) : (amount ?? "an unknown amount");

function HeldTerms({ held }: { held: Held }) {
  const terms = held.terms;
  if (!terms) {
    return (
      <span className="text-destructive">
        Not one of this dashboard's work-order payouts. Check it on the platform before voting.
      </span>
    );
  }
  const approved = terms.approvedAmount
    ? formatTokenAmount(terms.approvedAmount, terms.tokenId)
    : "an amount not yet approved";
  const price =
    terms.priceUsd && held.asset
      ? `, converted at ${terms.priceUsd} USD per ${tokenSymbol(tokenOf(held.asset))}`
      : "";
  return (
    <span className="text-muted-foreground">
      For the work order "{terms.workOrderTitle}": {approved} approved{price}.
    </span>
  );
}

export function PlatformOwnerActions({ owner, host }: { owner: string; host: string | null }) {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Rules | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const query = useQuery({
    queryKey: platformAgentReadKey("ownerView"),
    queryFn: () => apiClient.platformAgent.ownerView({}),
    retry: false,
    refetchInterval: (q) => (q.state.data?.actions.some((a) => a.open) ? 15_000 : false),
  });
  const deposit = useQuery({
    queryKey: platformAgentReadKey("deposit"),
    queryFn: () => apiClient.platformAgent.deposit({}),
    retry: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: platformAgentQueryKey });
  const failed = (fallback: string) => (err: Error) => {
    toast.error(err.message || fallback);
    refresh();
  };

  const save = useMutation({
    mutationFn: (rules: Rules) => apiClient.platformAgent.saveRules(rules),
    onSuccess: () => {
      setForm(null);
      toast.success("Payout rules saved; sign them to apply");
      refresh();
    },
    onError: failed("Couldn't save the rules"),
  });

  const prepare = useMutation({
    mutationFn: (input: { kind: Kind; grantId?: string; approvalId?: string; verdict?: Verdict }) =>
      apiClient.platformAgent.prepareAction(input),
    onSuccess: (result) => {
      setPrepared(result);
      refresh();
    },
    onError: failed("Couldn't prepare it"),
  });

  const sign = useMutation({
    mutationFn: async (ready: Prepared) => {
      if (!ready.intent) throw new Error("This one is signed on the confirm page");
      const signedData = await signAgentIntent(authClient, ready.intent, owner);
      return apiClient.platformAgent.submitAction({
        correlationId: ready.action.correlationId,
        signedData,
      });
    },
    onSuccess: (action) => {
      setPrepared(null);
      toast.success(`Signed; the platform says ${action.status.toLowerCase().replace(/_/g, " ")}`);
      refresh();
    },
    onError: failed("Couldn't sign it"),
  });

  const fund = useMutation({
    mutationFn: () => apiClient.platformAgent.fundAgent({}),
    onSuccess: refresh,
    onError: failed("Couldn't get a deposit address"),
  });

  const follow = useMutation({
    mutationFn: (correlationId: string) => apiClient.platformAgent.followAction({ correlationId }),
    onSuccess: refresh,
    onError: failed("Couldn't read its status"),
  });

  if (query.isLoading) return null;
  if (query.isError || !query.data) {
    return (
      <p className="text-sm text-destructive">
        {query.error?.message || "Couldn't read the agent's owner actions."}
      </p>
    );
  }
  const data = query.data;
  const values = form ??
    data.rules ?? { asset: "wnear", maxPerPayout: "", monthlyBudgetUsd: "", ownerApproval: false };
  const valid = decimal.test(values.maxPerPayout) && decimal.test(values.monthlyBudgetUsd);
  const busy =
    save.isPending || prepare.isPending || sign.isPending || follow.isPending || fund.isPending;
  const funding = deposit.data;
  const open = data.actions.filter((a) => a.open);
  const openKind = (kind: Kind) => open.some((a) => a.kind === kind);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h3>Owner actions</h3>
        </CardTitle>
        <CardDescription>
          Each one is prepared on the MultiAgency platform and signed by {owner}: in your wallet
          here when it's readable text, otherwise on the platform's confirm page at https://{host}
          /confirm/.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate(values);
          }}
        >
          <span className="text-sm font-medium">Payout rules</span>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(ASSET_LABELS) as Rules["asset"][]).map((asset) => (
              <Button
                key={asset}
                type="button"
                size="sm"
                variant={values.asset === asset ? "default" : "outline"}
                onClick={() => setForm({ ...values, asset })}
              >
                {ASSET_LABELS[asset]}
              </Button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={`Max per payout (${values.asset === "wnear" ? "wNEAR" : "USDC"})`}
              htmlFor="platform-cap"
            >
              <Input
                id="platform-cap"
                inputMode="decimal"
                value={values.maxPerPayout}
                onChange={(e) => setForm({ ...values, maxPerPayout: e.target.value })}
              />
            </Field>
            <Field label="Monthly budget (USD)" htmlFor="platform-budget">
              <Input
                id="platform-budget"
                inputMode="decimal"
                value={values.monthlyBudgetUsd}
                onChange={(e) => setForm({ ...values, monthlyBudgetUsd: e.target.value })}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.ownerApproval}
              onChange={(e) => setForm({ ...values, ownerApproval: e.target.checked })}
            />
            Each payout waits for the owner's vote here before it's sent
          </label>
          <Button type="submit" size="sm" className="self-start" disabled={busy || !valid}>
            {save.isPending ? "Saving…" : "Save the rules"}
          </Button>
        </form>

        {data.pending.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-4">
            <span className="text-sm font-medium">The signed rules differ</span>
            <ul className="list-disc pl-5 text-sm">
              {data.pending.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <Button
              size="sm"
              className="self-start"
              disabled={busy || openKind("rules") || !data.applied}
              onClick={() => prepare.mutate({ kind: "rules" })}
            >
              Prepare the updated rules
            </Button>
          </div>
        )}

        {data.held.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-4">
            <span className="text-sm font-medium">Waiting for the owner's vote</span>
            <p className="text-sm text-muted-foreground">
              The platform's vote text doesn't name the payee or the amount. They're shown here.
            </p>
            <ul className="flex flex-col gap-3 text-sm">
              {data.held.map((h) => (
                <li key={h.approvalId} className="flex flex-col gap-1">
                  <span>
                    {amountOf(h.amount, h.asset)} to {h.recipient ?? "an unknown payee"}
                    {h.chain
                      ? ` by withdrawal to their ${h.chain.toUpperCase()} account`
                      : " by confidential transfer"}
                    , held since {new Date(h.at).toLocaleString()}
                  </span>
                  <HeldTerms held={h} />
                  <div className="flex gap-2">
                    {(["approve", "reject"] as const).map((verdict) => (
                      <Button
                        key={verdict}
                        size="sm"
                        variant={verdict === "approve" ? "default" : "outline"}
                        disabled={busy || openKind("payout_vote")}
                        onClick={() =>
                          prepare.mutate({ kind: "payout_vote", approvalId: h.approvalId, verdict })
                        }
                      >
                        {verdict === "approve" ? "Approve this payout" : "Reject it"}
                      </Button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t pt-4">
          <span className="text-sm font-medium">MultiAgency's permission to pay</span>
          <p className="text-sm text-muted-foreground">
            {data.grant
              ? `Valid until ${new Date(data.grant.expiresAt).toLocaleDateString()}.`
              : "None: MultiAgency can't pay from this agent."}
          </p>
          <div className="flex flex-wrap gap-2">
            {(!data.grant || data.grant.expiringSoon) && (
              <Button
                size="sm"
                disabled={busy || openKind("grant")}
                onClick={() => prepare.mutate({ kind: "grant" })}
              >
                {data.grant ? "Renew for 90 days" : "Let MultiAgency pay for 90 days"}
              </Button>
            )}
            {data.grant && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || openKind("grant_revoke")}
                onClick={() =>
                  data.grant &&
                  prepare.mutate({ kind: "grant_revoke", grantId: data.grant.grantId })
                }
              >
                Revoke the permission
              </Button>
            )}
            {data.frozen === false && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || openKind("freeze")}
                onClick={() => prepare.mutate({ kind: "freeze" })}
              >
                Freeze the agent
              </Button>
            )}
            {data.frozen === true && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || openKind("unfreeze")}
                onClick={() => prepare.mutate({ kind: "unfreeze" })}
              >
                Unfreeze the agent
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t pt-4">
          <span className="text-sm font-medium">Fund the agent</span>
          {funding?.usable && funding.address ? (
            <div className="flex flex-col gap-1 text-sm">
              <span>
                Send {funding.symbol} to this deposit address. It credits only this agent's balance.
              </span>
              <span className="break-all font-mono text-xs">{funding.address}</span>
              {funding.memo && (
                <span>
                  Memo: <span className="font-mono text-xs">{funding.memo}</span>
                </span>
              )}
              {funding.minAmount && (
                <span>
                  At least {formatTokenAmount(funding.minAmount, tokenOf(funding.asset))}.
                </span>
              )}
              {funding.expiresAt && (
                <span className="text-muted-foreground">
                  Valid until {new Date(funding.expiresAt).toLocaleString()}.
                </span>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {funding?.state === "unknown" || funding?.state === "requesting"
                ? "The platform hasn't confirmed the address yet. Ask again to check."
                : funding?.state === "refused"
                  ? `The platform refused the last request (${funding.code ?? "no reason given"}).`
                  : "Get a one-time address that credits this agent in the asset its rules pay."}
            </p>
          )}
          {!funding?.usable && (
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              disabled={busy || !data.rules}
              onClick={() => fund.mutate()}
            >
              {fund.isPending ? "Asking…" : "Get a deposit address"}
            </Button>
          )}
        </div>

        {prepared?.intent && (
          <Alert>
            <AlertTitle>Sign: {prepared.action.summary}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              {prepared.preview && (
                <>
                  <span>The platform prepared: {prepared.preview.summary}</span>
                  {prepared.preview.after && (
                    <details>
                      <summary className="cursor-pointer">The rules as they'll be</summary>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                        {JSON.stringify(prepared.preview.after, null, 2)}
                      </pre>
                    </details>
                  )}
                </>
              )}
              <SigningText
                message={prepared.intent.payload.message}
                recipient={prepared.intent.payload.recipient}
                expiresAt={prepared.action.expiresAt}
                host={host ?? prepared.intent.payload.recipient}
              />
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => sign.mutate(prepared)}>
                  {sign.isPending ? "Waiting for the wallet…" : `Sign with ${owner}`}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPrepared(null)}>
                  Not now
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {data.actions.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-4">
            <span className="text-sm font-medium">Recent owner actions</span>
            <ul className="flex flex-col gap-2 text-sm">
              {data.actions.map((action) => (
                <li key={action.correlationId} className="flex flex-wrap items-center gap-2">
                  <span>{action.summary}</span>
                  <Badge variant={action.open ? "secondary" : "outline"}>
                    {action.status.toLowerCase().replace(/_/g, " ")}
                  </Badge>
                  {action.confirmUrl && (
                    <Button size="sm" asChild>
                      <a href={action.confirmUrl} target="_blank" rel="noopener noreferrer">
                        Sign on the confirm page
                      </a>
                    </Button>
                  )}
                  {action.open && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => follow.mutate(action.correlationId)}
                    >
                      Check its status
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
