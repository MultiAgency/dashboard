import { LockKeyIcon, WarningIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Spinner,
} from "@/components";
import { AuthCardHeader } from "@/components/auth-card-header";

type ResetSearch = { token?: string; error?: string };

export const Route = createFileRoute("/_layout/reset-password")({
  validateSearch: (search: Record<string, unknown>): ResetSearch => ({
    token: typeof search.token === "string" ? search.token : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  head: () => ({
    meta: [{ title: "Set a new password" }, { name: "description", content: "Choose a password." }],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token, error } = Route.useSearch();
  const authClient = useAuthClient();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const mismatch = submitted && confirm.length > 0 && password !== confirm;

  const reset = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("This reset link is missing its token");
      const { error: resetError } = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (resetError) throw new Error(resetError.message ?? "Could not set the password");
    },
    onSuccess: () => {
      toast.success("Password set. Sign in with your new password.");
      navigate({ to: "/sign-in", replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (password !== confirm) return;
    reset.mutate();
  };

  return (
    <div className="mx-auto flex w-full max-w-sm animate-fade-in flex-col gap-6 sm:py-8">
      {error || !token ? (
        <Card>
          <AuthCardHeader
            icon={<WarningIcon aria-hidden />}
            title="Link expired"
            description="This reset link is invalid or has expired. Request a new one to choose a password."
          />
          <CardFooter>
            <Button asChild className="w-full">
              <Link to="/sign-in" search={{ mode: "forgot" }}>
                Request a new link
              </Link>
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Card>
          <AuthCardHeader
            icon={<LockKeyIcon aria-hidden />}
            title="Set a new password"
            description="Choose a password you don't use anywhere else."
          />
          <CardContent>
            <form onSubmit={submit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="reset-password">New password</FieldLabel>
                  <Input
                    id="reset-password"
                    type="password"
                    autoComplete="new-password"
                    aria-describedby="reset-password-description"
                    minLength={8}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <FieldDescription id="reset-password-description">
                    At least 8 characters.
                  </FieldDescription>
                </Field>
                <Field data-invalid={mismatch || undefined}>
                  <FieldLabel htmlFor="reset-password-confirm">Confirm password</FieldLabel>
                  <Input
                    id="reset-password-confirm"
                    type="password"
                    autoComplete="new-password"
                    aria-invalid={mismatch || undefined}
                    aria-describedby={mismatch ? "reset-password-confirm-error" : undefined}
                    minLength={8}
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                  {mismatch && (
                    <FieldError id="reset-password-confirm-error" aria-live="polite">
                      The passwords do not match.
                    </FieldError>
                  )}
                </Field>
                <Button type="submit" className="w-full" disabled={reset.isPending}>
                  {reset.isPending && <Spinner data-icon="inline-start" />}
                  {reset.isPending ? "Saving…" : "Set password"}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
