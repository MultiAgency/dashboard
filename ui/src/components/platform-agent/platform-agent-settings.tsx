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
import { AdminError } from "@/components/admin-error";
import { Field, Loading } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PlatformAgentPanel } from "@/components/platform-agent/platform-agent-panel";
import { PlatformOwnerActions } from "@/components/platform-agent/platform-owner-actions";
import { SigningText } from "@/components/platform-agent/signing-text";
import { SettingsSection } from "@/components/settings-section";
import { useMeRoles } from "@/hooks/use-me-roles";
import { type ApiClient, useApiClient } from "@/lib/api";
import { sessionQueryOptions, useAuthClient } from "@/lib/auth";
import { ownerWalletKey, signAgentIntent } from "@/lib/payout-agent-signing";
import { signPlatformText } from "@/lib/platform-agent-signing";
import { platformAgentQueryKey, platformAgentQueryOptions } from "@/lib/queries";

type View = Awaited<ReturnType<ApiClient["platformAgent"]["view"]>>;
type Days = View["consentDays"][number];

export function PlatformAgentSection() {
  const apiClient = useApiClient();
  const query = useQuery(platformAgentQueryOptions(apiClient));
  if (!query.data?.available) return null;
  return (
    <SettingsSection
      id="platform-agent"
      title="MultiAgency platform agent"
      description="Connect a payout agent on the MultiAgency platform."
    >
      <PlatformAgentSettings />
    </SettingsSection>
  );
}

export function PlatformAgentSettings() {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const { agencyDao, organizationId } = useMeRoles();
  const [owner, setOwner] = useState<string | null>(null);
  const [days, setDays] = useState<Days>(90);
  const [withPayouts, setWithPayouts] = useState(false);
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const isSiteAdmin = session?.user?.role === "admin";
  const [disconnecting, setDisconnecting] = useState(false);
  const query = useQuery({
    ...platformAgentQueryOptions(apiClient),
    refetchInterval: (q) => (q.state.data?.state === "creating" ? 15_000 : false),
  });

  const setData = (data: View) =>
    queryClient.setQueryData(platformAgentQueryOptions(apiClient).queryKey, data);
  const failed = (fallback: string) => (err: Error) => {
    toast.error(err.message || fallback);
    queryClient.invalidateQueries({ queryKey: platformAgentQueryKey });
  };

  const startSetup = useMutation({
    mutationFn: (ownerAccountId: string) => apiClient.platformAgent.startSetup({ ownerAccountId }),
    onSuccess: setData,
    onError: failed("Couldn't start the setup"),
  });

  const startConsent = useMutation({
    mutationFn: (chosen: { days: Days; payout: boolean }) =>
      apiClient.platformAgent.startConsent(chosen),
    onSuccess: setData,
    onError: failed("Couldn't prepare the consent"),
  });

  const sign = useMutation({
    mutationFn: async (view: View) => {
      if (!view.signing || !view.ownerAccountId) throw new Error("Nothing to sign");
      const { kind, message, recipient, nonce } = view.signing;
      const signed = await signPlatformText(authClient, view.ownerAccountId, {
        message,
        recipient,
        nonce,
      });
      return {
        kind,
        view: await apiClient.platformAgent.submitSigned({ message, nonce, ...signed }),
      };
    },
    onSuccess: ({ kind, view }) => {
      setData(view);
      toast.success(
        kind === "setup" ? "Agent reserved; create it next" : "Platform agent connected",
      );
    },
    onError: failed("Couldn't send the signature"),
  });

  const retry = useMutation({
    mutationFn: () => apiClient.platformAgent.retry({}),
    onSuccess: setData,
    onError: failed("The platform still didn't answer"),
  });

  const create = useMutation({
    mutationFn: async (view: View) => {
      if (!view.ownerAccountId || !view.setupPublicKey) throw new Error("Set up the agent first");
      const key = await ownerWalletKey(authClient, view.ownerAccountId);
      if (key !== view.setupPublicKey) {
        throw new Error(
          `Use the wallet key that signed the setup (${view.setupPublicKey}); this wallet uses ${key ?? "another key"}.`,
        );
      }
      const prepared = await apiClient.platformAgent.prepareCreate({});
      setData(prepared.view);
      if (!prepared.intent || !prepared.view.create) return prepared.view;
      const signedData = await signAgentIntent(authClient, prepared.intent, view.ownerAccountId);
      return apiClient.platformAgent.submitCreate({
        correlationId: prepared.view.create.correlationId,
        signedData,
      });
    },
    onSuccess: setData,
    onError: failed("Couldn't create the agent"),
  });

  const follow = useMutation({
    mutationFn: () => apiClient.platformAgent.followCreate({}),
    onSuccess: setData,
    onError: failed("Couldn't read the creation's status"),
  });

  const switchRoute = useMutation({
    mutationFn: (route: View["payoutRoute"]) => {
      if (!organizationId) throw new Error("No active Organization");
      return apiClient.platformAgent.setPayoutRoute({ organizationId, route });
    },
    onSuccess: ({ route }) => {
      toast.success(
        route === "platform"
          ? "Approved compensation now pays through the platform agent"
          : "Approved compensation pays through the old payout agent again",
      );
      queryClient.invalidateQueries({ queryKey: platformAgentQueryKey });
    },
    onError: failed("Couldn't switch payouts"),
  });

  const disconnect = useMutation({
    mutationFn: () => apiClient.platformAgent.disconnect({}),
    onSuccess: (view) => {
      setData(view);
      toast.success("Disconnected from the platform agent");
    },
    onError: failed("Couldn't disconnect"),
  });

  if (query.isLoading) return <Loading label="Loading the platform agent" />;
  if (query.isError || !query.data) return <AdminError error={query.error} />;
  const data = query.data;
  const busy =
    startSetup.isPending ||
    startConsent.isPending ||
    sign.isPending ||
    retry.isPending ||
    create.isPending ||
    follow.isPending ||
    disconnect.isPending;
  const ownerValue = owner ?? data.ownerAccountId ?? "";

  const consentPicker = (label: string) => (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Access lasts" htmlFor="platform-consent-days">
        <div id="platform-consent-days" className="flex gap-1">
          {data.consentDays.map((d) => (
            <Button
              key={d}
              size="sm"
              type="button"
              variant={days === d ? "default" : "outline"}
              onClick={() => setDays(d)}
            >
              {d} days
            </Button>
          ))}
        </div>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={withPayouts}
          onChange={(e) => setWithPayouts(e.target.checked)}
        />
        Also let it request payouts to agreed builders, within the signed rules
      </label>
      <Button
        size="sm"
        disabled={busy}
        onClick={() => startConsent.mutate({ days, payout: withPayouts })}
      >
        {label}
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>MultiAgency platform agent</h2>
          </CardTitle>
          <CardDescription>
            A payout agent on the MultiAgency platform, owned by your wallet. You sign what this
            dashboard may do with it: read it, and prepare owner actions that your wallet signs
            again each time. This dashboard never holds its keys or grants.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant={data.state === "connected" ? "outline" : "secondary"}>
              {STATE_LABELS[data.state]}
            </Badge>
            {data.agent && <Badge variant="outline">{data.agent}</Badge>}
            {data.ownerAccountId && <Badge variant="outline">Owner {data.ownerAccountId}</Badge>}
          </div>
          {data.error && <p className="text-sm text-destructive">{data.error}</p>}

          {agencyDao && data.state !== "connected" && (
            <Alert>
              <AlertTitle>One wallet, the DAO's money</AlertTitle>
              <AlertDescription>
                This agent is owned by one wallet. If {agencyDao} funds it, that wallet alone sets
                the payees and caps for the DAO's money. Agents owned by the DAO itself aren't
                available in the dashboard yet.
              </AlertDescription>
            </Alert>
          )}

          {(data.state === "not_connected" || data.state === "setup_expired") && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (ownerValue.trim()) startSetup.mutate(ownerValue.trim());
              }}
            >
              {data.state === "setup_expired" && (
                <p className="text-sm text-muted-foreground">
                  The setup expired before the agent was created. Sign a new setup; it finds the
                  same agent.
                </p>
              )}
              <Field
                label="Owner (NEAR account)"
                htmlFor="platform-owner"
                helper="Owns the agent and signs its rules. Can't change once the agent exists."
              >
                <Input
                  id="platform-owner"
                  value={ownerValue}
                  disabled={!!data.agent}
                  onChange={(e) => setOwner(e.target.value)}
                />
              </Field>
              <Button type="submit" size="sm" className="self-start" disabled={busy || !ownerValue}>
                {startSetup.isPending ? "Preparing…" : "Set up a platform agent"}
              </Button>
            </form>
          )}

          {data.signing && (
            <div className="flex flex-col gap-3">
              <SigningText
                message={data.signing.message}
                recipient={data.signing.recipient}
                expiresAt={data.signing.expiresAt}
              />
              <Button
                size="sm"
                className="self-start"
                disabled={busy}
                onClick={() => sign.mutate(data)}
              >
                {sign.isPending ? "Waiting for the wallet…" : `Sign with ${data.ownerAccountId}`}
              </Button>
            </div>
          )}

          {data.retryable && (
            <Alert>
              <AlertTitle>The platform didn't answer</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <span>
                  Your signature is kept. Send it again; you won't be asked to sign again.
                </span>
                <Button
                  size="sm"
                  className="self-start"
                  disabled={busy}
                  onClick={() => retry.mutate()}
                >
                  {retry.isPending ? "Sending…" : "Send again"}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {data.state === "creating" && (
            <div className="flex flex-col gap-3">
              {data.create?.confirmUrl ? (
                <>
                  <p className="text-sm">
                    Creating the agent is signed on the MultiAgency platform's own confirm page,
                    which shows its rules from the platform's record. Sign there with{" "}
                    {data.ownerAccountId} before{" "}
                    {data.create.expiresAt
                      ? new Date(data.create.expiresAt).toLocaleTimeString()
                      : "it expires"}
                    . Only sign on a page at https://{data.host}/confirm/.
                  </p>
                  <Button size="sm" className="self-start" asChild>
                    <a href={data.create.confirmUrl} target="_blank" rel="noopener noreferrer">
                      Open the confirm page
                    </a>
                  </Button>
                </>
              ) : data.create ? (
                <p className="text-sm text-muted-foreground">
                  A creation is already open
                  {data.create.expiresAt
                    ? ` until ${new Date(data.create.expiresAt).toLocaleTimeString()}`
                    : ""}
                  . Follow its status; don't sign it again. If it isn't signed by then, create the
                  agent again.
                </p>
              ) : (
                <Button
                  size="sm"
                  className="self-start"
                  disabled={busy}
                  onClick={() => create.mutate(data)}
                >
                  {create.isPending ? "Waiting for the wallet…" : "Create the agent"}
                </Button>
              )}
              {data.create && (
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  disabled={busy}
                  onClick={() => follow.mutate()}
                >
                  {follow.isPending ? "Checking…" : "Check its status"}
                </Button>
              )}
            </div>
          )}

          {data.state === "needs_consent" &&
            !data.signing &&
            consentPicker("Let this dashboard use the agent")}

          {data.state === "ended" && !data.signing && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                This dashboard's access to the agent ended. The owner, {data.ownerAccountId}, signs
                a new consent to reconnect.
              </p>
              {consentPicker("Reconnect")}
            </div>
          )}

          {data.state === "connected" && data.consent && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Access: {data.consent.scopes.join(", ")}, until{" "}
                {new Date(data.consent.expiresAt).toLocaleDateString()}.
              </p>
              <p className="text-sm">
                Approved compensation pays through{" "}
                {data.payoutRoute === "platform"
                  ? "this platform agent."
                  : "the old payout agent (Automatic payouts), not this one."}
              </p>
              {!data.consent.scopes.includes("payout") && !data.signing && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm text-muted-foreground">
                    To pay through this agent, the owner signs a consent that includes payouts.
                  </span>
                  {consentPicker("Prepare a consent")}
                </div>
              )}
              {isSiteAdmin && data.consent.scopes.includes("payout") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  disabled={busy || switchRoute.isPending}
                  onClick={() =>
                    switchRoute.mutate(data.payoutRoute === "platform" ? "legacy" : "platform")
                  }
                >
                  {data.payoutRoute === "platform"
                    ? "Site admin: pay through the old payout agent"
                    : "Site admin: pay through this platform agent"}
                </Button>
              )}
              {data.consent.expiringSoon && !data.signing && (
                <Alert>
                  <AlertTitle>Access ends soon</AlertTitle>
                  <AlertDescription className="flex flex-col gap-2">
                    <span>
                      The owner signs a new consent so the dashboard keeps reading the agent.
                    </span>
                    {consentPicker("Renew access")}
                  </AlertDescription>
                </Alert>
              )}
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                disabled={busy}
                onClick={() => setDisconnecting(true)}
              >
                Disconnect
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {data.state === "connected" && <PlatformAgentPanel />}
      {data.state === "connected" && data.ownerAccountId && (
        <PlatformOwnerActions owner={data.ownerAccountId} host={data.host} />
      )}

      <ConfirmDialog
        open={disconnecting}
        onOpenChange={setDisconnecting}
        title="Disconnect the platform agent?"
        description={`This dashboard stops reading the agent at once. The agent and its balance stay with ${data.ownerAccountId ?? "its owner"} on the MultiAgency platform. Reconnecting needs a new signature from that wallet.`}
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => disconnect.mutateAsync().then(() => undefined)}
      />
    </div>
  );
}

const STATE_LABELS: Record<View["state"], string> = {
  off: "Off",
  not_connected: "Not connected",
  setup_pending: "Waiting for the owner's setup signature",
  setup_expired: "Setup expired",
  creating: "Creating the agent",
  needs_consent: "Waiting for the owner's consent",
  consent_pending: "Waiting for the owner's consent signature",
  connected: "Connected",
  ended: "Access ended",
};
