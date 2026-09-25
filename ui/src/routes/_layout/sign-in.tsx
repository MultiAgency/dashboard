import { ArrowLeftIcon, EnvelopeSimpleIcon, WalletIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components";
import { AuthCardHeader } from "@/components/auth-card-header";
import { ResendVerificationButton } from "@/components/resend-verification-button";
import { useNearSignIn } from "@/hooks/use-near-sign-in";
import {
  createRedirectOnce,
  landingDestination,
  refreshAfterAccountChange,
  requestPasswordReset,
  WELCOME_PATH,
} from "@/lib/account";
import { useApiClient } from "@/lib/api";
import { sessionQueryOptions } from "@/lib/auth";
import { safeRedirect } from "@/lib/landing";

type Mode = "sign-in" | "sign-up" | "forgot";

type SignInSearch = {
  mode?: Mode;
  email?: string;
  redirect?: string;
};

const MODES: Mode[] = ["sign-in", "sign-up", "forgot"];

export const Route = createFileRoute("/_layout/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    mode: MODES.includes(search.mode as Mode) ? (search.mode as Mode) : undefined,
    email: typeof search.email === "string" ? search.email : undefined,
    redirect: safeRedirect(search.redirect) ?? undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in" },
      { name: "description", content: "Sign in with email and password or a NEAR wallet." },
    ],
  }),
  component: SignInPage,
});

function usePostSignIn(redirectTo: string | undefined) {
  const authClient = useAuthClient();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return async () => {
    const destination =
      redirectTo ?? (await landingDestination({ authClient, apiClient, queryClient }));
    await navigate({ to: destination, replace: true });
  };
}

function SignInPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const authClient = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const mode = search.mode ?? "sign-in";
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const finish = usePostSignIn(search.redirect);
  const [redirectOnce] = useState(createRedirectOnce);
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const redirect = () => redirectOnce(finishRef.current);
  const completeSignIn = async () => {
    const refreshed = await refreshAfterAccountChange(queryClient, authClient);
    if (!refreshed?.user) throw new Error("Signed in, but the session did not load. Try again.");
    await redirect();
  };
  const nearSignIn = useNearSignIn(redirect);
  const signedIn = Boolean(session?.user);

  useEffect(() => {
    if (!signedIn) return;
    redirectOnce(finishRef.current).catch((e: Error) => toast.error(e.message));
  }, [signedIn, redirectOnce]);

  const setMode = (next: Mode) => {
    setVerificationEmail(null);
    void navigate({ search: (prev) => ({ ...prev, mode: next }), replace: true });
  };

  const callbackURL = search.redirect ?? WELCOME_PATH;

  return (
    <div className="mx-auto flex w-full max-w-sm animate-fade-in flex-col gap-6 sm:py-8">
      {verificationEmail ? (
        <VerificationPending
          email={verificationEmail}
          callbackURL={callbackURL}
          onBack={() => setMode("sign-in")}
        />
      ) : mode === "forgot" ? (
        <ForgotPasswordCard defaultEmail={search.email} onBack={() => setMode("sign-in")} />
      ) : (
        <Card>
          <AuthCardHeader
            title={mode === "sign-up" ? "Create your account" : "Sign in to MultiAgency"}
            description={
              mode === "sign-up"
                ? "Use your email and a password, or a NEAR wallet."
                : "Welcome back. Sign in with your email or a NEAR wallet."
            }
          />
          <CardContent className="flex flex-col gap-6">
            <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
              <TabsList className="w-full">
                <TabsTrigger value="sign-in">Sign in</TabsTrigger>
                <TabsTrigger value="sign-up">Create account</TabsTrigger>
              </TabsList>
              <TabsContent value="sign-in" className="mt-2">
                <SignInForm
                  defaultEmail={search.email}
                  onSignedIn={completeSignIn}
                  onUnverified={setVerificationEmail}
                />
              </TabsContent>
              <TabsContent value="sign-up" className="mt-2">
                <SignUpForm
                  defaultEmail={search.email}
                  callbackURL={callbackURL}
                  onSignedUp={setVerificationEmail}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
          <CardFooter className="flex-col gap-3">
            <p className="text-xs text-muted-foreground">Or continue with</p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => nearSignIn.mutate()}
              disabled={nearSignIn.isPending}
            >
              {nearSignIn.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <WalletIcon data-icon="inline-start" aria-hidden />
              )}
              {nearSignIn.isPending ? "Connecting…" : "NEAR wallet"}
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

function SignInForm({
  defaultEmail,
  onSignedIn,
  onUnverified,
}: {
  defaultEmail?: string;
  onSignedIn: () => Promise<void>;
  onUnverified: (email: string) => void;
}) {
  const authClient = useAuthClient();
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [password, setPassword] = useState("");

  const signIn = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signIn.email({ email: email.trim(), password });
      if (error) {
        if (errorCode(error) === "EMAIL_NOT_VERIFIED") return "unverified" as const;
        throw new Error(error.message ?? "Sign in failed");
      }
      return "signed-in" as const;
    },
    onSuccess: async (result) => {
      if (result === "unverified") {
        onUnverified(email.trim());
        return;
      }
      await onSignedIn();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    signIn.mutate();
  };

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="sign-in-email">Email</FieldLabel>
          <Input
            id="sign-in-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="sign-in-password">Password</FieldLabel>
            <Link
              to="/sign-in"
              search={(prev) => ({ ...prev, mode: "forgot" })}
              replace
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="sign-in-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" className="w-full" disabled={signIn.isPending}>
          {signIn.isPending && <Spinner data-icon="inline-start" />}
          {signIn.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </FieldGroup>
    </form>
  );
}

function SignUpForm({
  defaultEmail,
  callbackURL,
  onSignedUp,
}: {
  defaultEmail?: string;
  callbackURL: string;
  onSignedUp: (email: string) => void;
}) {
  const authClient = useAuthClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [password, setPassword] = useState("");

  const signUp = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
        callbackURL,
      });
      if (error) throw new Error(error.message ?? "Could not create the account");
    },
    onSuccess: () => onSignedUp(email.trim()),
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    signUp.mutate();
  };

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="sign-up-name">Name</FieldLabel>
          <Input
            id="sign-up-name"
            autoComplete="name"
            placeholder="Your name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="sign-up-email">Email</FieldLabel>
          <Input
            id="sign-up-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-describedby="sign-up-email-description"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <FieldDescription id="sign-up-email-description">
            Invited? Use the address your invitation was sent to.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="sign-up-password">Password</FieldLabel>
          <Input
            id="sign-up-password"
            type="password"
            autoComplete="new-password"
            aria-describedby="sign-up-password-description"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <FieldDescription id="sign-up-password-description">
            At least 8 characters.
          </FieldDescription>
        </Field>
        <Button type="submit" className="w-full" disabled={signUp.isPending}>
          {signUp.isPending && <Spinner data-icon="inline-start" />}
          {signUp.isPending ? "Creating account…" : "Create account"}
        </Button>
      </FieldGroup>
    </form>
  );
}

function VerificationPending({
  email,
  callbackURL,
  onBack,
}: {
  email: string;
  callbackURL: string;
  onBack: () => void;
}) {
  return (
    <Card>
      <AuthCardHeader
        icon={<EnvelopeSimpleIcon aria-hidden />}
        title="Check your email"
        description={
          <>
            We sent a verification link to{" "}
            <span className="font-medium break-all text-foreground">{email}</span>. Open it to
            confirm your address and you come straight back here.
          </>
        }
      />
      <CardFooter className="flex-col gap-2">
        <ResendVerificationButton
          email={email}
          callbackURL={callbackURL}
          label="Resend email"
          variant="default"
          className="w-full"
        />
        <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
          <ArrowLeftIcon data-icon="inline-start" aria-hidden />
          Back to sign in
        </Button>
      </CardFooter>
    </Card>
  );
}

function ForgotPasswordCard({
  defaultEmail,
  onBack,
}: {
  defaultEmail?: string;
  onBack: () => void;
}) {
  const authClient = useAuthClient();
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [sent, setSent] = useState(false);

  const request = useMutation({
    mutationFn: () => requestPasswordReset(authClient, email.trim()),
    onSuccess: () => setSent(true),
    onError: (e: Error) => toast.error(e.message),
  });

  const back = (
    <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
      <ArrowLeftIcon data-icon="inline-start" aria-hidden />
      Back to sign in
    </Button>
  );

  if (sent) {
    return (
      <Card>
        <AuthCardHeader
          icon={<EnvelopeSimpleIcon aria-hidden />}
          title="Check your email"
          description={
            <>
              If an account exists for{" "}
              <span className="font-medium break-all text-foreground">{email.trim()}</span>, a link
              to set a new password is on its way.
            </>
          }
        />
        <CardFooter>{back}</CardFooter>
      </Card>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    request.mutate();
  };

  return (
    <Card>
      <AuthCardHeader
        title="Reset your password"
        description="Enter your email and we send you a link to choose a new password."
      />
      <CardContent>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
              <Input
                id="forgot-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Button type="submit" className="w-full" disabled={request.isPending}>
              {request.isPending && <Spinner data-icon="inline-start" />}
              {request.isPending ? "Sending…" : "Send reset link"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>{back}</CardFooter>
    </Card>
  );
}
