import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components";
import { useNearSignIn } from "@/hooks";
import { sessionQueryKey, sessionQueryOptions } from "@/lib/auth";
import { meRolesQueryKey } from "@/lib/queries";

type SearchParams = { redirect?: string };

function safeRedirect(target: string | undefined): string {
  return target?.startsWith("/") && !target.startsWith("//") ? target : "/";
}

export const Route = createFileRoute("/_layout/login")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: async ({ context, search }) => {
    const session = await context.queryClient.ensureQueryData(
      sessionQueryOptions(context.authClient, context.session),
    );
    if (session?.user) throw redirect({ to: safeRedirect(search.redirect) });
  },
  head: () => ({
    meta: [{ title: "Sign in" }, { name: "description", content: "Sign in to MultiAgency." }],
  }),
  component: LoginPage,
});

const LABEL_CLS = "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground";

function LoginPage() {
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const target = safeRedirect(search.redirect);
  const callbackURL = typeof window === "undefined" ? target : `${window.location.origin}${target}`;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationSentTo, setVerificationSentTo] = useState<string | null>(null);

  const finish = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
      queryClient.invalidateQueries({ queryKey: meRolesQueryKey }),
    ]);
    navigate({ to: target, replace: true });
  };

  const near = useNearSignIn(() => void finish());

  const signIn = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signIn.email({
        email: email.trim(),
        password,
        callbackURL,
      });
      if (error) throw new Error(error.message || "Failed to sign in");
    },
    onSuccess: finish,
    onError: (error: Error) => toast.error(error.message),
  });

  const signUp = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signUp.email({
        name: name.trim() || email.trim(),
        email: email.trim(),
        password,
        callbackURL,
      });
      if (error) throw new Error(error.message || "Failed to create account");
    },
    onSuccess: () => setVerificationSentTo(email.trim()),
    onError: (error: Error) => toast.error(error.message),
  });

  const pending = signIn.isPending || signUp.isPending || near.isPending;

  const submit = (mutation: { mutate: () => void }) => (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  if (verificationSentTo) {
    return (
      <Card className="max-w-md mx-auto mt-12">
        <CardContent className="space-y-3 text-center">
          <h1 className="font-display text-2xl uppercase tracking-tight font-extrabold">
            Check your email
          </h1>
          <p className="text-sm text-muted-foreground">
            We sent a verification link to{" "}
            <span className="font-medium text-foreground">{verificationSentTo}</span>. Open it to
            finish signing in.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-12 space-y-6 animate-fade-in">
      <header className="space-y-2">
        <div className={LABEL_CLS}>welcome · back</div>
        <h1 className="font-display text-4xl uppercase leading-none tracking-tight font-black">
          Sign in
        </h1>
      </header>

      <Card>
        <CardContent className="space-y-5">
          <Tabs defaultValue="sign-in">
            <TabsList className="w-full">
              <TabsTrigger value="sign-in">sign in</TabsTrigger>
              <TabsTrigger value="sign-up">create account</TabsTrigger>
            </TabsList>

            <TabsContent value="sign-in">
              <form className="space-y-4 pt-2" onSubmit={submit(signIn)}>
                <EmailField value={email} onChange={setEmail} />
                <PasswordField
                  value={password}
                  onChange={setPassword}
                  autoComplete="current-password"
                />
                <Button type="submit" className="w-full" disabled={pending}>
                  {signIn.isPending ? "signing in..." : "sign in with email"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="sign-up">
              <form className="space-y-4 pt-2" onSubmit={submit(signUp)}>
                <div className="space-y-1.5">
                  <Label htmlFor="name" className={LABEL_CLS}>
                    name
                  </Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </div>
                <EmailField value={email} onChange={setEmail} />
                <PasswordField
                  value={password}
                  onChange={setPassword}
                  autoComplete="new-password"
                />
                <Button type="submit" className="w-full" disabled={pending}>
                  {signUp.isPending ? "creating..." : "create account"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => near.mutate()}
            disabled={pending}
          >
            {near.isPending ? "connecting..." : "sign in with NEAR"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function EmailField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="email" className={LABEL_CLS}>
        email
      </Label>
      <Input
        id="email"
        type="email"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="email"
      />
    </div>
  );
}

function PasswordField({
  value,
  onChange,
  autoComplete,
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="password" className={LABEL_CLS}>
        password
      </Label>
      <Input
        id="password"
        type="password"
        required
        minLength={8}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
      />
    </div>
  );
}
