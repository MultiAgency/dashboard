import {
  EnvelopeOpenIcon,
  EnvelopeSimpleIcon,
  HandshakeIcon,
  UserSwitchIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  Skeleton,
  Spinner,
} from "@/components";
import { AuthCardHeader } from "@/components/auth-card-header";
import { roleLabel } from "@/components/organization-row-card";
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
    return (
      <Page>
        <InvitationSkeleton />
      </Page>
    );
  }

  const state: InvitationState | "declined" = declined
    ? "declined"
    : classifyInvitation({
        signedIn,
        invitation: invitationQuery.data?.invitation,
        error: invitationQuery.data?.error,
      });
  const userEmail = session?.user?.email ?? null;

  return (
    <Page>
      {state === "signed-out" && <SignedOut redirect={here} email={search.email} />}
      {state === "verify-email" && <VerifyEmail email={userEmail} callbackURL={here} />}
      {state === "wrong-email" && <WrongEmail email={userEmail} redirect={here} />}
      {state === "pending" && (
        <PendingInvitation
          id={id}
          invitation={invitationQuery.data?.invitation ?? null}
          onDeclined={() => setDeclined(true)}
        />
      )}
      {state === "declined" && (
        <Outcome
          icon={<XCircleIcon aria-hidden />}
          title="Invitation declined"
          description="You declined this invitation. The person who invited you can send a new one."
        />
      )}
      {state === "unavailable" && (
        <Outcome
          icon={<WarningIcon aria-hidden />}
          title="Invitation unavailable"
          description="This invitation is no longer valid. It may have expired, been declined or canceled, or already been used. Ask the person who invited you to send a new one."
        />
      )}
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-md animate-fade-in flex-col gap-6 sm:py-8">
      {children}
    </div>
  );
}

function InvitationSkeleton() {
  return (
    <Card role="status" aria-live="polite">
      <CardHeader className="justify-items-center gap-3">
        <Skeleton className="size-10" />
        <Skeleton className="h-5 w-3/5" />
        <Skeleton className="h-3 w-4/5" />
      </CardHeader>
      <CardFooter className="gap-2">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 flex-1" />
      </CardFooter>
      <span className="sr-only">Loading invitation</span>
    </Card>
  );
}

function PendingInvitation({
  id,
  invitation,
  onDeclined,
}: {
  id: string;
  invitation: InvitationDetails | null;
  onDeclined: () => void;
}) {
  const { accept, decline, busy } = useInvitationActions();

  return (
    <Card>
      {invitation ? (
        <AuthCardHeader
          icon={<HandshakeIcon aria-hidden />}
          title={`Join ${invitation.organizationName}`}
          description={
            <>
              <span className="font-medium break-all text-foreground">
                {invitation.inviterEmail}
              </span>{" "}
              invited you to join this Organization on MultiAgency.
            </>
          }
        />
      ) : (
        <AuthCardHeader
          icon={<HandshakeIcon aria-hidden />}
          title="Your Organization is ready"
          description="An Agency set up an Organization for you on MultiAgency and invited you as its first admin. You own it and manage its team; the Agency is not a member."
        />
      )}
      {invitation && (
        <CardContent className="flex justify-center">
          <Badge variant="secondary">Role: {roleLabel(invitation.role)}</Badge>
        </CardContent>
      )}
      <CardFooter className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => decline.mutate(id, { onSuccess: onDeclined })}
          disabled={busy}
        >
          {decline.isPending && <Spinner data-icon="inline-start" />}
          Decline
        </Button>
        <Button type="button" onClick={() => accept.mutate(id)} disabled={busy}>
          {accept.isPending && <Spinner data-icon="inline-start" />}
          {accept.isPending ? "Joining…" : "Accept"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function Outcome({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <AuthCardHeader icon={icon} title={title} description={description} />
      <CardFooter>
        <Button asChild variant="outline" className="w-full">
          <Link to="/welcome">Continue</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function SignedOut({ redirect, email }: { redirect: string; email?: string }) {
  return (
    <Card>
      <AuthCardHeader
        icon={<EnvelopeOpenIcon aria-hidden />}
        title="You're invited"
        description="Someone invited you to join their Organization. Create an account with the email the invitation was sent to, or sign in if you already have one. You come straight back here to accept."
      />
      <CardFooter className="flex-col gap-2">
        <Button asChild className="w-full">
          <Link to="/sign-in" search={{ mode: "sign-up", redirect, email }}>
            Create account
          </Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link to="/sign-in" search={{ mode: "sign-in", redirect, email }}>
            Sign in
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function VerifyEmail({ email, callbackURL }: { email: string | null; callbackURL: string }) {
  const shownEmail = realEmail(email);
  return (
    <Card>
      <AuthCardHeader
        icon={<EnvelopeSimpleIcon aria-hidden />}
        title="Verify your email"
        description={
          <>
            Verify{" "}
            {shownEmail ? (
              <span className="font-medium break-all text-foreground">{shownEmail}</span>
            ) : (
              "your email"
            )}{" "}
            before answering this invitation. The link in the verification email brings you back
            here.
          </>
        }
      />
      <CardFooter>
        <ResendVerificationButton
          email={email}
          callbackURL={callbackURL}
          label="Send verification email"
          variant="default"
          className="w-full"
        />
      </CardFooter>
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
    <Card>
      <AuthCardHeader
        icon={<UserSwitchIcon aria-hidden />}
        title="This invitation is for another email"
        description={
          <>
            {shownEmail ? (
              <>
                You're signed in as{" "}
                <span className="font-medium break-all text-foreground">{shownEmail}</span>, but the
                invitation was sent to a different address.
              </>
            ) : (
              "The invitation was sent to an email address this account does not have."
            )}{" "}
            Sign in with the invited email, or add it to this account on your Profile and open the
            link again.
          </>
        }
      />
      <CardFooter className="flex-col gap-2">
        <Button
          type="button"
          className="w-full"
          onClick={() => switchAccount.mutate()}
          disabled={switchAccount.isPending}
        >
          {switchAccount.isPending && <Spinner data-icon="inline-start" />}
          {switchAccount.isPending ? "Signing out…" : "Sign out and switch account"}
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link to="/profile">Open Profile</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
