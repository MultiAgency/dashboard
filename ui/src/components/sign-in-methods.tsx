import {
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  PasswordIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { LoadingCard } from "@/components/loading-card";
import { ResendVerificationButton } from "@/components/resend-verification-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
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
  if (accountsQuery.isLoading) return <LoadingCard label="sign-in methods" rows={3} />;

  const accounts = accountsQuery.data;
  const verified = !!email && user.emailVerified;
  const hasPassword = !!accounts?.hasPassword;
  const nearAccountId = accounts?.nearAccountId ?? null;

  return (
    <ItemGroup>
      <MethodItem
        icon={<EnvelopeSimpleIcon aria-hidden className="text-muted-foreground" />}
        title="Email"
        status={email ? (verified ? "Verified" : "Unverified") : "Not added"}
        active={verified}
        description={email ?? "Add an email to sign in with a password and receive invitations."}
        actions={
          email && !verified ? (
            <ResendVerificationButton
              email={email}
              callbackURL="/profile"
              label="Send verification"
              size="sm"
            />
          ) : null
        }
        footer={email ? null : <AddEmailForm onAdded={refresh} />}
      />
      <MethodItem
        icon={<PasswordIcon aria-hidden className="text-muted-foreground" />}
        title="Password"
        status={hasPassword ? "Set" : "Not set"}
        active={hasPassword}
        description={
          hasPassword
            ? "You can sign in with your email and password."
            : verified
              ? "We email you a link to choose a password, so you can sign in without a wallet."
              : "Add and verify an email first."
        }
        actions={
          hasPassword ? null : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPassword.mutate()}
              disabled={!verified || setPassword.isPending}
            >
              {setPassword.isPending && <Spinner data-icon="inline-start" />}
              Set password
            </Button>
          )
        }
      />
      <MethodItem
        icon={<WalletIcon aria-hidden className="text-muted-foreground" />}
        title="NEAR wallet"
        status={nearAccountId ? "Linked" : "Not linked"}
        active={!!nearAccountId}
        description={
          nearAccountId ??
          "Link a wallet to receive payouts or act onchain. You can then sign in with it too."
        }
        actions={
          nearAccountId ? null : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => linkNear.mutate()}
              disabled={linkNear.isPending}
            >
              {linkNear.isPending && <Spinner data-icon="inline-start" />}
              Link wallet
            </Button>
          )
        }
      />
    </ItemGroup>
  );
}

function MethodItem({
  icon,
  title,
  status,
  active,
  description,
  actions,
  footer,
}: {
  icon: ReactNode;
  title: string;
  status: string;
  active: boolean;
  description: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Item asChild variant="outline" size="sm">
      <li>
        <ItemMedia variant="icon">{icon}</ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>
            {title}
            <Badge variant={active ? "secondary" : "outline"}>
              {active && <CheckCircleIcon data-icon="inline-start" aria-hidden />}
              {status}
            </Badge>
          </ItemTitle>
          <ItemDescription className="break-all">{description}</ItemDescription>
        </ItemContent>
        {actions && <ItemActions>{actions}</ItemActions>}
        {footer && <ItemFooter>{footer}</ItemFooter>}
      </li>
    </Item>
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
    <form className="flex w-full flex-col gap-2 sm:flex-row sm:items-end" onSubmit={submit}>
      <Field className="flex-1">
        <FieldLabel htmlFor="add-email" className="sr-only">
          Email address
        </FieldLabel>
        <Input
          id="add-email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          required
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          disabled={change.isPending}
        />
      </Field>
      <Button type="submit" disabled={change.isPending || !newEmail.trim()}>
        {change.isPending && <Spinner data-icon="inline-start" />}
        Add email
      </Button>
    </form>
  );
}
