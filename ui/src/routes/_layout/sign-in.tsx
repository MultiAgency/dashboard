import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Button, Card, CardContent, Input } from "@/components";
import { Field } from "@/components/admin-form";
import { ResendVerificationButton } from "@/components/resend-verification-button";
import { useNearSignIn } from "@/hooks/use-near-sign-in";
import {
  landingDestination,
  refreshAccountQueries,
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

const MODE_TITLES: Record<Mode, string> = {
  "sign-in": "Sign in",
  "sign-up": "Create account",
  forgot: "Reset password",
};

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
  const refreshSession = () => refreshAccountQueries(queryClient);
  const finish = usePostSignIn(search.redirect);
  const nearSignIn = useNearSignIn(refreshSession);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!session?.user || redirecting) return;
    setRedirecting(true);
    finish().catch((e: Error) => {
      toast.error(e.message);
      setRedirecting(false);
    });
  }, [session?.user, redirecting, finish]);

  const setMode = (next: Mode) => {
    setVerificationEmail(null);
    void navigate({ search: (prev) => ({ ...prev, mode: next }), replace: true });
  };

  const callbackURL = search.redirect ?? WELCOME_PATH;

  return (
    <div className="mx-auto max-w-md space-y-8 animate-fade-in">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          your · account
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-black uppercase leading-none tracking-tight">
          {verificationEmail ? "Check your email" : MODE_TITLES[mode]}
        </h1>
      </header>

      {verificationEmail ? (
        <VerificationPending
          email={verificationEmail}
          callbackURL={callbackURL}
          onBack={() => setMode("sign-in")}
        />
      ) : (
        <>
          {mode === "sign-in" && (
            <SignInForm
              defaultEmail={search.email}
              onSignedIn={refreshSession}
              onUnverified={setVerificationEmail}
              onForgot={() => setMode("forgot")}
            />
          )}
          {mode === "sign-up" && (
            <SignUpForm
              defaultEmail={search.email}
              callbackURL={callbackURL}
              onSignedUp={setVerificationEmail}
            />
          )}
          {mode === "forgot" && <ForgotPasswordForm defaultEmail={search.email} />}

          <div className="flex flex-wrap gap-x-4 gap-y-2 font-mono text-[11px] uppercase tracking-[0.18em]">
            {mode !== "sign-in" && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                onClick={() => setMode("sign-in")}
              >
                have an account? sign in
              </button>
            )}
            {mode !== "sign-up" && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                onClick={() => setMode("sign-up")}
              >
                new here? create an account
              </button>
            )}
          </div>

          <section className="space-y-3">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              or
            </div>
            <Button
              variant="outline"
              className="w-full font-display uppercase tracking-wide"
              onClick={() => nearSignIn.mutate()}
              disabled={nearSignIn.isPending}
            >
              {nearSignIn.isPending ? "connecting..." : "continue with NEAR wallet"}
            </Button>
          </section>
        </>
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
  onForgot,
}: {
  defaultEmail?: string;
  onSignedIn: () => Promise<void>;
  onUnverified: (email: string) => void;
  onForgot: () => void;
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
    <Card>
      <CardContent>
        <form className="grid gap-4" onSubmit={submit}>
          <Field label="email" htmlFor="sign-in-email">
            <Input
              id="sign-in-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="password" htmlFor="sign-in-password">
            <Input
              id="sign-in-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground underline underline-offset-2"
              onClick={onForgot}
            >
              forgot password?
            </button>
            <Button type="submit" disabled={signIn.isPending}>
              {signIn.isPending ? "signing in..." : "sign in →"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
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
    <Card>
      <CardContent>
        <form className="grid gap-4" onSubmit={submit}>
          <Field label="name" htmlFor="sign-up-name">
            <Input
              id="sign-up-name"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field
            label="email"
            htmlFor="sign-up-email"
            helper="Use the address your invitation was sent to."
          >
            <Input
              id="sign-up-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="password" htmlFor="sign-up-password" helper="At least 8 characters.">
            <Input
              id="sign-up-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={signUp.isPending}>
              {signUp.isPending ? "creating..." : "create account →"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
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
    <Card variant="hi-vis">
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed">
          We sent a verification link to <span className="font-mono">{email}</span>. Open it to
          confirm your address; it brings you straight back here to continue.
        </p>
        <div className="flex flex-wrap gap-2">
          <ResendVerificationButton email={email} callbackURL={callbackURL} label="resend email" />
          <Button variant="ghost" onClick={onBack}>
            back to sign in
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ForgotPasswordForm({ defaultEmail }: { defaultEmail?: string }) {
  const authClient = useAuthClient();
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [sent, setSent] = useState(false);

  const request = useMutation({
    mutationFn: () => requestPasswordReset(authClient, email.trim()),
    onSuccess: () => setSent(true),
    onError: (e: Error) => toast.error(e.message),
  });

  if (sent) {
    return (
      <Card variant="hi-vis">
        <CardContent className="text-sm leading-relaxed">
          If an account exists for <span className="font-mono">{email.trim()}</span>, a link to set
          a new password is on its way.
        </CardContent>
      </Card>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    request.mutate();
  };

  return (
    <Card>
      <CardContent>
        <form className="grid gap-4" onSubmit={submit}>
          <Field label="email" htmlFor="forgot-email">
            <Input
              id="forgot-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={request.isPending}>
              {request.isPending ? "sending..." : "send reset link →"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
