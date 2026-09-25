import { ArrowRightIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Badge, Button, Card, CardContent } from "@/components";
import { LoadingCard } from "@/components/loading-card";
import { useInvitationActions } from "@/components/pending-invitations";
import { ResendVerificationButton } from "@/components/resend-verification-button";
import { refreshAfterAccountChange } from "@/lib/account";
import { sessionQueryOptions } from "@/lib/auth";
import { classifyInvitation, type InvitationState } from "@/lib/invitations";
import { realEmail } from "@/lib/membership";

type InvitationSearch = { email?: string };

export const Route = createFileRoute("/_layout/accept-invitation/$id")({
  validateSearch: (search: Record<string, unknown>): InvitationSearch => ({
    email: typeof search.email === "string" ? search.email : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Invitation" },
      { name: "description", content: "Join an Organization on MultiAgency." },
    ],
  }),
  component: AcceptInvitationPage,
});

type PageState = InvitationState | "declined";

type InvitationDetails = {
  role: string | null;
  organizationName: string;
  inviterEmail: string;
};

type InvitationLookup = {
  invitation: InvitationDetails | null;
  error: { status?: number; code?: string; message?: string } | null;
};

function AcceptInvitationPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const authClient = useAuthClient();
  const { data: session, isLoading: sessionLoading } = useQuery(sessionQueryOptions(authClient));
  const signedIn = !!session?.user;
  const [declined, setDeclined] = useState(false);
  const { accept, decline, busy } = useInvitationActions();

  const invitationQuery = useQuery({
    queryKey: ["invitation", id, session?.user?.id ?? null],
    queryFn: async (): Promise<InvitationLookup> => {
      const { data, error } = await authClient.organization.getInvitation({ query: { id } });
      return {
        invitation: (data as InvitationDetails | null) ?? null,
        error: error ?? null,
      };
    },
    enabled: signedIn,
    retry: false,
  });

  const here = `/accept-invitation/${id}`;

  if (sessionLoading || (signedIn && invitationQuery.isLoading)) {
    return <Page state={null} />;
  }

  const state: PageState = declined
    ? "declined"
    : classifyInvitation({
        signedIn,
        invitation: invitationQuery.data?.invitation,
        error: invitationQuery.data?.error,
      });
  const invitation = invitationQuery.data?.invitation ?? null;
  const userEmail = session?.user?.email ?? null;

  return (
    <Page state={state}>
      {state === "signed-out" && <SignedOut redirect={here} email={search.email} />}
      {state === "verify-email" && <VerifyEmail email={userEmail} callbackURL={here} />}
      {state === "wrong-email" && <WrongEmail email={userEmail} redirect={here} />}
      {state === "pending" && (
        <Card variant="highlight">
          <CardContent className="space-y-4">
            {invitation ? (
              <div className="space-y-1">
                <div className="text-3xl uppercase tracking-tight font-extrabold leading-tight break-words">
                  {invitation.organizationName}
                </div>
                <p className="text-sm text-muted-foreground">
                  <span className="font-mono">{invitation.inviterEmail}</span> invited you to join
                  as <Badge variant="outline">{invitation.role ?? "member"}</Badge>
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                An Agency set up an Organization for you on MultiAgency and invited you as its first
                admin. You will own it and manage its team; the Agency is not a member.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => accept.mutate(id)} disabled={busy}>
                {accept.isPending ? "joining..." : "accept"}
                <ArrowRightIcon data-icon="inline-end" aria-hidden />
              </Button>
              <Button
                variant="outline"
                onClick={() => decline.mutate(id, { onSuccess: () => setDeclined(true) })}
                disabled={busy}
              >
                decline
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {state === "declined" && <Message>You declined this invitation.</Message>}
      {state === "unavailable" && (
        <Message>
          This invitation is no longer valid. It may have expired, been declined or canceled, or
          already been used. Ask the person who invited you to send a new one.
        </Message>
      )}
    </Page>
  );
}

const TITLES: Record<PageState, string> = {
  "signed-out": "You're invited",
  "verify-email": "Verify your email",
  "wrong-email": "Different account",
  pending: "Join Organization",
  declined: "Invitation declined",
  unavailable: "Invitation unavailable",
};

function Page({ state, children }: { state: PageState | null; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl space-y-8 animate-fade-in">
      <header className="space-y-2">
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          organization · invitation
        </div>
        <h1 className="text-4xl sm:text-5xl font-black uppercase leading-none tracking-tight">
          {state ? TITLES[state] : "Invitation"}
        </h1>
      </header>
      {state ? children : <LoadingCard label="invitation" />}
    </div>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed">{children}</p>
        <Button asChild variant="outline">
          <Link to="/welcome">
            continue
            <ArrowRightIcon data-icon="inline-end" aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function SignedOut({ redirect, email }: { redirect: string; email?: string }) {
  return (
    <Card variant="highlight">
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed">
          Someone invited you to join their Organization. Create an account with the email address
          the invitation was sent to, verify it, and you'll come straight back here to accept. If
          you already have an account with that email, sign in instead.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/sign-in" search={{ mode: "sign-up", redirect, email }}>
              create account
              <ArrowRightIcon data-icon="inline-end" aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/sign-in" search={{ mode: "sign-in", redirect, email }}>
              sign in
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function VerifyEmail({ email, callbackURL }: { email: string | null; callbackURL: string }) {
  return (
    <Card variant="highlight">
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed">
          Verify <span className="font-mono">{email}</span> before answering this invitation. The
          link in the verification email brings you back here.
        </p>
        <ResendVerificationButton
          email={email}
          callbackURL={callbackURL}
          label="send verification email"
        />
      </CardContent>
    </Card>
  );
}

function WrongEmail({ email, redirect }: { email: string | null; redirect: string }) {
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const shownEmail = realEmail(email);

  const switchAccount = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message ?? "Failed to sign out");
      await authClient.near.disconnect().catch(() => {});
    },
    onSuccess: async () => {
      await refreshAfterAccountChange(queryClient, authClient);
      navigate({ to: "/sign-in", search: { redirect }, replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card variant="highlight">
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed">
          {shownEmail ? (
            <>
              This invitation was sent to a different email than{" "}
              <span className="font-mono">{shownEmail}</span>.
            </>
          ) : (
            <>This invitation was sent to an email address this account does not have.</>
          )}{" "}
          Sign out and sign in with the invited email, or add that email to this account on your
          Profile and open the link again.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => switchAccount.mutate()} disabled={switchAccount.isPending}>
            {switchAccount.isPending ? "signing out..." : "sign out and switch"}
            <ArrowRightIcon data-icon="inline-end" aria-hidden />
          </Button>
          <Button asChild variant="outline">
            <Link to="/profile">open profile</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
