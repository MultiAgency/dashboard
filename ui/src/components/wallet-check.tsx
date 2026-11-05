import { CopyIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuthClient } from "@/lib/auth";
import {
  connectedWallet,
  type DelegateCheck,
  type DelegateObservation,
  delegateEvidenceCells,
  evidenceRow,
  SAMPLE_DELEGATE,
  sampleConsentText,
  signDelegateCheck,
  signWalletCheck,
  WALLET_CHECK_WALLETS,
  type WalletCheckResult,
  type WalletObservation,
} from "@/lib/wallet-check";

type Observed = Omit<WalletObservation, "wallet">;

const OBSERVATIONS: { key: keyof Observed; label: string }[] = [
  { key: "showedMessage", label: "The wallet showed the whole text above" },
  { key: "showedRecipient", label: "The wallet showed the recipient" },
  { key: "warnedRecipient", label: "The wallet warned that the recipient isn't this site" },
];

const DELEGATE_OBSERVATIONS: { key: keyof DelegateObservation; label: string }[] = [
  {
    key: "showedReceiver",
    label: `The wallet showed the receiver (${SAMPLE_DELEGATE.receiverId})`,
  },
  { key: "showedMethod", label: `The wallet showed the method (${SAMPLE_DELEGATE.methodName})` },
  { key: "showedArgs", label: "The wallet showed the arguments" },
  { key: "showedDeposit", label: "The wallet showed the deposit (none)" },
];

export function WalletCheck() {
  const authClient = useAuthClient();
  const [account, setAccount] = useState(() => authClient.near.getState()?.accountId ?? null);
  const [wallet, setWallet] = useState(() => connectedWallet() ?? "");
  const [recipient, setRecipient] = useState("");
  const [expiresAt] = useState(() => new Date(Date.now() + 86_400_000).toISOString());
  const [observed, setObserved] = useState<Observed>({
    showedMessage: false,
    showedRecipient: false,
    warnedRecipient: false,
  });
  const [result, setResult] = useState<WalletCheckResult | null>(null);
  const [delegateObserved, setDelegateObserved] = useState<DelegateObservation>({
    showedReceiver: false,
    showedMethod: false,
    showedArgs: false,
    showedDeposit: false,
  });
  const [delegateResult, setDelegateResult] = useState<DelegateCheck | null>(null);

  const host = recipient.trim();
  const message = account && host ? sampleConsentText(host, account, expiresAt) : null;

  const connect = useMutation({
    mutationFn: async () => {
      await authClient.near.ensureConnected();
      return authClient.near.getState()?.accountId ?? null;
    },
    onSuccess: (accountId) => {
      setAccount(accountId);
      setWallet(connectedWallet() ?? wallet);
      setResult(null);
    },
    onError: (e: Error) => toast.error(e.message || "Could not connect a wallet"),
  });

  const sign = useMutation({
    mutationFn: async (text: string) =>
      signWalletCheck(authClient, text, host, window.location.href),
    onSuccess: setResult,
    onError: (e: Error) => toast.error(e.message || "Could not ask the wallet to sign"),
  });

  const signDelegate = useMutation({
    mutationFn: () => signDelegateCheck(authClient),
    onSuccess: setDelegateResult,
    onError: (e: Error) => toast.error(e.message || "Could not ask the wallet to sign"),
  });

  const row =
    result && wallet
      ? evidenceRow(
          new Date().toISOString().slice(0, 10),
          host,
          { wallet, ...observed },
          result,
          delegateEvidenceCells(delegateObserved, delegateResult),
        )
      : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Wallet check"
        description="Development only. Signs a sample consent text with NEP-413 for the platform host and a sample delegate action with NEP-366, checks both here, and builds a row for docs/wallet-signing-evidence.md. Nothing is sent to the platform or relayed."
      />

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Text to sign</h2>
          </CardTitle>
          <CardDescription>
            The exact text the wallet should show. The recipient is the platform host, not this
            site, and there's no callback URL.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
              <Field>
                <FieldLabel htmlFor="wallet-check-recipient">Recipient (platform host)</FieldLabel>
                <Input
                  id="wallet-check-recipient"
                  autoComplete="off"
                  value={recipient}
                  onChange={(e) => {
                    setRecipient(e.target.value);
                    setResult(null);
                  }}
                  placeholder="platform.example"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="wallet-check-wallet">Wallet</FieldLabel>
                <Select value={wallet} onValueChange={setWallet}>
                  <SelectTrigger id="wallet-check-wallet" className="w-full">
                    <SelectValue placeholder="Choose the wallet you connected" />
                  </SelectTrigger>
                  <SelectContent>
                    {WALLET_CHECK_WALLETS.map((id) => (
                      <SelectItem key={id} value={id}>
                        {id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {account ? `Connected as ${account}.` : "No wallet connected."}
                </FieldDescription>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="wallet-check-text">Text</FieldLabel>
              <Textarea
                id="wallet-check-text"
                readOnly
                value={message ?? ""}
                placeholder="Connect a wallet and enter the platform host"
                className="font-mono text-xs"
              />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={connect.isPending}
            onClick={() => connect.mutate()}
          >
            {account ? "Reconnect wallet" : "Connect wallet"}
          </Button>
          <Button
            type="button"
            disabled={!message || sign.isPending}
            onClick={() => message && sign.mutate(message)}
          >
            Sign
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Delegate action to sign (NEP-366)</h2>
          </CardTitle>
          <CardDescription>
            A function call to {SAMPLE_DELEGATE.receiverId}, method {SAMPLE_DELEGATE.methodName}, no
            deposit, built and signed as a delegate action. It's never relayed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Textarea
              readOnly
              value={JSON.stringify(SAMPLE_DELEGATE, null, 2)}
              className="font-mono text-xs"
              aria-label="Delegate action"
            />
            {delegateResult && (
              <div className="flex flex-wrap gap-2">
                {delegateResult.kind === "signed" ? (
                  <>
                    <Badge variant="secondary">Signed ({delegateResult.format})</Badge>
                    <Badge variant={delegateResult.matchesRequest ? "secondary" : "destructive"}>
                      {delegateResult.matchesRequest
                        ? "Matches the request"
                        : `Differs: ${delegateResult.senderId} → ${delegateResult.receiverId} ${delegateResult.methodNames.join(", ")}`}
                    </Badge>
                    <Badge variant={delegateResult.verifies ? "secondary" : "destructive"}>
                      {delegateResult.verifies === null
                        ? "Signature not checked here"
                        : delegateResult.verifies
                          ? "Signature verifies"
                          : "Signature doesn't verify"}
                    </Badge>
                  </>
                ) : (
                  <Badge variant="destructive">Not signed: {delegateResult.error}</Badge>
                )}
              </div>
            )}
            {delegateResult &&
              DELEGATE_OBSERVATIONS.map(({ key, label }) => (
                <Field key={key} orientation="horizontal">
                  <Checkbox
                    id={`wallet-check-${key}`}
                    checked={delegateObserved[key]}
                    onCheckedChange={(checked) =>
                      setDelegateObserved((current) => ({ ...current, [key]: checked === true }))
                    }
                  />
                  <FieldLabel htmlFor={`wallet-check-${key}`} className="font-normal">
                    {label}
                  </FieldLabel>
                </Field>
              ))}
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            disabled={!account || signDelegate.isPending}
            onClick={() => signDelegate.mutate()}
          >
            Sign delegate action
          </Button>
        </CardFooter>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Result</h2>
            </CardTitle>
            <CardDescription>
              {result.kind === "signed"
                ? `Signed as ${result.accountId} with ${result.publicKey}.`
                : `Not signed: ${result.error}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {result.kind === "signed" && (
                <div className="flex flex-wrap gap-2">
                  <Badge variant={result.verifiesWithoutCallbackUrl ? "secondary" : "destructive"}>
                    {result.verifiesWithoutCallbackUrl
                      ? "Verifies without a callback URL"
                      : "Doesn't verify without a callback URL"}
                  </Badge>
                  {result.verifiesWithPageUrl && (
                    <Badge variant="destructive">Signed with this page as callback URL</Badge>
                  )}
                  <Badge
                    variant={
                      result.fullAccessKey === null
                        ? "outline"
                        : result.fullAccessKey
                          ? "secondary"
                          : "destructive"
                    }
                  >
                    {result.fullAccessKey === null
                      ? "Key not checked on chain"
                      : result.fullAccessKey
                        ? "Full-access key of the account"
                        : "Not a full-access key of the account"}
                  </Badge>
                </div>
              )}
              {OBSERVATIONS.map(({ key, label }) => (
                <Field key={key} orientation="horizontal">
                  <Checkbox
                    id={`wallet-check-${key}`}
                    checked={observed[key]}
                    onCheckedChange={(checked) =>
                      setObserved((current) => ({ ...current, [key]: checked === true }))
                    }
                  />
                  <FieldLabel htmlFor={`wallet-check-${key}`} className="font-normal">
                    {label}
                  </FieldLabel>
                </Field>
              ))}
              <Field>
                <FieldLabel htmlFor="wallet-check-row">Evidence row</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="wallet-check-row"
                    readOnly
                    value={row ?? ""}
                    placeholder="Choose the wallet first"
                    className="flex-1 font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Copy the evidence row"
                    disabled={!row}
                    onClick={() => {
                      if (!row) return;
                      void navigator.clipboard
                        .writeText(row)
                        .then(() => toast.success("Row copied"))
                        .catch(() => toast.error("Could not copy the row"));
                    }}
                  >
                    <CopyIcon aria-hidden />
                  </Button>
                </div>
                <FieldDescription>
                  Take a screenshot of the wallet's signing screen too.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
