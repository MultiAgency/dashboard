import { ArrowRightIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Badge, Button, Card, CardContent, Input } from "@/components";
import { ResendVerificationButton } from "@/components/resend-verification-button";
import { refreshAccountQueries, requestPasswordReset } from "@/lib/account";
import { sessionQueryOptions } from "@/lib/auth";
import { realEmail } from "@/lib/membership";

const linkedAccountsQueryKey = ["me", "linked-accounts"] as const;

export function SignInMethods() {
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const user = session?.user;
  const email = realEmail(user?.email);

  const accountsQuery = useQuery({
    queryKey: linkedAccountsQueryKey,
    queryFn: async () => {
      const [accounts, near] = await Promise.all([
        authClient.listAccounts(),
        authClient.near.listAccounts(),
      ]);
      return {
        hasPassword: (accounts.data ?? []).some((a) => a.providerId === "credential"),
        nearAccountId: near.data?.accounts[0]?.accountId ?? null,
      };
    },
    enabled: !!user,
  });

  const refresh = async () => {
    await Promise.all([
      refreshAccountQueries(queryClient),
      queryClient.invalidateQueries({ queryKey: linkedAccountsQueryKey }),
    ]);
  };

  const linkNear = useMutation({
    mutationFn: () =>
      new Promise<void>((resolve, reject) => {
        void authClient.near.link({ onSuccess: () => resolve(), onError: reject });
      }),
    onSuccess: async () => {
      toast.success("NEAR wallet linked");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message || "Could not link the NEAR wallet"),
  });

  const setPassword = useMutation({
    mutationFn: async () => {
      if (!email) throw new Error("Add an email first");
      await requestPasswordReset(authClient, email);
    },
    onSuccess: () => toast.success(`We emailed ${email} a link to set your password`),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!user) return null;

  const accounts = accountsQuery.data;
  const verified = !!email && user.emailVerified;

  return (
    <Card>
      <CardContent className="grid gap-5">
        <MethodRow
          label="email"
          status={email ? (verified ? "verified" : "unverified") : "not added"}
          active={verified}
        >
          {email ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs break-all">{email}</span>
              {!verified && (
                <ResendVerificationButton
                  email={email}
                  callbackURL="/profile"
                  label="send verification"
                  size="sm"
                />
              )}
            </div>
          ) : (
            <AddEmailForm onAdded={refresh} />
          )}
        </MethodRow>

        <MethodRow
          label="password"
          status={accounts?.hasPassword ? "set" : "not set"}
          active={!!accounts?.hasPassword}
        >
          {!accounts?.hasPassword && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {verified
                  ? "We email you a link to choose a password, so you can sign in without a wallet."
                  : "Add and verify an email first."}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPassword.mutate()}
                disabled={!verified || setPassword.isPending}
              >
                {setPassword.isPending ? "sending..." : "set password"}
              </Button>
            </div>
          )}
        </MethodRow>

        <MethodRow
          label="near wallet"
          status={accounts?.nearAccountId ? "linked" : "not linked"}
          active={!!accounts?.nearAccountId}
        >
          {accounts?.nearAccountId ? (
            <span className="font-mono text-xs break-all">{accounts.nearAccountId}</span>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Link a wallet to receive payouts or act onchain. You can then sign in with it too.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => linkNear.mutate()}
                disabled={linkNear.isPending || accountsQuery.isLoading}
              >
                {linkNear.isPending ? "linking..." : "link NEAR wallet"}
              </Button>
            </div>
          )}
        </MethodRow>
      </CardContent>
    </Card>
  );
}

function MethodRow({
  label,
  status,
  active,
  children,
}: {
  label: string;
  status: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[10rem_1fr] sm:items-start">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <Badge variant={active ? "default" : "outline"}>{status}</Badge>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function AddEmailForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const authClient = useAuthClient();
  const [newEmail, setNewEmail] = useState("");

  const change = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.changeEmail({
        newEmail: newEmail.trim(),
        callbackURL: "/profile",
      });
      if (error) throw new Error(error.message ?? "Could not add the email");
    },
    onSuccess: async () => {
      toast.success(`Check ${newEmail.trim()} for a link to confirm it`);
      setNewEmail("");
      await onAdded();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    change.mutate();
  };

  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
      <Input
        type="email"
        aria-label="email address"
        placeholder="you@example.com"
        autoComplete="email"
        required
        value={newEmail}
        onChange={(e) => setNewEmail(e.target.value)}
        disabled={change.isPending}
      />
      <Button type="submit" size="sm" disabled={change.isPending || !newEmail.trim()}>
        {change.isPending ? "adding..." : "add email"}
        <ArrowRightIcon data-icon="inline-end" aria-hidden />
      </Button>
    </form>
  );
}
