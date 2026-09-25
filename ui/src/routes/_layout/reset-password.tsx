import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Button, Card, CardContent, Input } from "@/components";
import { Field } from "@/components/admin-form";

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

  const reset = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("This reset link is missing its token");
      if (password !== confirm) throw new Error("The passwords do not match");
      const { error: resetError } = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (resetError) throw new Error(resetError.message ?? "Could not set the password");
    },
    onSuccess: () => {
      toast.success("Password set");
      navigate({ to: "/sign-in", replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    reset.mutate();
  };

  return (
    <div className="mx-auto max-w-md space-y-8 animate-fade-in">
      <header className="space-y-2">
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          your · account
        </div>
        <h1 className="text-4xl sm:text-5xl font-black uppercase leading-none tracking-tight">
          New password
        </h1>
      </header>

      {error || !token ? (
        <Card variant="highlight">
          <CardContent className="space-y-4">
            <p>This reset link is invalid or has expired. Request a new one.</p>
            <Button asChild variant="outline">
              <Link to="/sign-in" search={{ mode: "forgot" }}>
                request a new link
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <form className="grid gap-4" onSubmit={submit}>
              <Field label="new password" htmlFor="reset-password" helper="At least 8 characters.">
                <Input
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="confirm password" htmlFor="reset-password-confirm">
                <Input
                  id="reset-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" disabled={reset.isPending}>
                  {reset.isPending ? "saving..." : "set password →"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
