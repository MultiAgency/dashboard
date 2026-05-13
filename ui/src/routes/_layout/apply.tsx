import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button, Card, CardContent, Input, Spinner, Textarea } from "@/components";
import { useApiClient } from "@/lib/api";
import { nearnSponsorUrl } from "@/lib/nearn";

export const Route = createFileRoute("/_layout/apply")({
  head: () => ({
    meta: [
      { title: "Join MultiAgency" },
      { name: "description", content: "Apply to join MultiAgency as a contributor." },
    ],
  }),
  component: ApplyPage,
});

const applySchema = z.object({
  name: z.string().trim().min(1, "name required"),
  email: z.string().trim().min(1, "email required").email("not a valid email"),
  nearAccountId: z.string().trim().optional(),
  message: z.string().trim().optional(),
});

type ApplyValues = z.infer<typeof applySchema>;

const LABEL_CLS = "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground block";
const ERROR_CLS = "text-sm text-destructive";

function ApplyPage() {
  const apiClient = useApiClient();
  const settingsQuery = useQuery({
    queryKey: ["settings", "public"],
    queryFn: () => apiClient.settings.getPublic(),
    staleTime: 5 * 60_000,
  });
  const nearnUrl = settingsQuery.data?.nearnAccountId
    ? nearnSponsorUrl(settingsQuery.data.nearnAccountId)
    : null;

  const [submitted, setSubmitted] = useState(false);

  const submitMutation = useMutation({
    mutationFn: async (values: ApplyValues) =>
      apiClient.applications.create({
        kind: "contributor",
        name: values.name,
        email: values.email,
        nearAccountId: values.nearAccountId || undefined,
        message: values.message || undefined,
      }),
    onSuccess: () => {
      setSubmitted(true);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to submit");
    },
  });

  const form = useForm({
    defaultValues: {
      name: "",
      email: "",
      nearAccountId: "",
      message: "",
    } as ApplyValues,
    validators: { onChange: applySchema },
    onSubmit: async ({ value }) => {
      await submitMutation.mutateAsync(value);
    },
  });

  const isPending = submitMutation.isPending;

  if (submitted) {
    return (
      <div className="max-w-xl mx-auto space-y-6 pt-4 animate-fade-in">
        <Card variant="hi-vis">
          <CardContent className="p-8 space-y-4 text-center">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              agency · application received
            </div>
            <h1 className="font-display text-3xl sm:text-4xl uppercase tracking-tight font-extrabold leading-[0.95]">
              Thanks! Let's build.
            </h1>
            <p className="font-mono text-xs leading-relaxed text-muted-foreground">
              Your application was received. We'll email next steps — a short contractor agreement
              and a tax form (W-9 or W-8BEN) — before any work or payout.
            </p>
            <div className="pt-2">
              <Button
                asChild
                variant="outline"
                size="sm"
                className="font-display uppercase tracking-wide"
              >
                <Link to="/">← back to home</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6 pt-4 animate-fade-in">
      <header className="space-y-3 text-center">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          agency · join
        </div>
        <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tight font-black leading-[0.95]">
          Join MultiAgency
        </h1>
      </header>

      <Card>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Tell us who you are and what you build. We will follow up.{" "}
            <Link
              to="/docs/$slug"
              params={{ slug: "contributors" }}
              className="underline underline-offset-2 hover:text-foreground"
            >
              how onboarding works →
            </Link>
          </p>
          {nearnUrl && (
            <a
              href={nearnUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors"
            >
              find opportunities via nearn →
            </a>
          )}

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            <form.Field name="name">
              {(field) => (
                <div className="space-y-2">
                  <label htmlFor={field.name} className={LABEL_CLS}>
                    name
                  </label>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="your name"
                    disabled={isPending}
                  />
                  {field.state.meta.errors[0] && (
                    <p className={ERROR_CLS}>{fieldErrorMessage(field.state.meta.errors[0])}</p>
                  )}
                </div>
              )}
            </form.Field>
            <form.Field name="email">
              {(field) => (
                <div className="space-y-2">
                  <label htmlFor={field.name} className={LABEL_CLS}>
                    email
                  </label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="email@example.com"
                    disabled={isPending}
                  />
                  {field.state.meta.errors[0] && (
                    <p className={ERROR_CLS}>{fieldErrorMessage(field.state.meta.errors[0])}</p>
                  )}
                </div>
              )}
            </form.Field>
            <form.Field name="nearAccountId">
              {(field) => (
                <div className="space-y-2">
                  <label htmlFor={field.name} className={LABEL_CLS}>
                    near account (optional)
                  </label>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value ?? ""}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="account.near"
                    disabled={isPending}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="message">
              {(field) => (
                <div className="space-y-2">
                  <label htmlFor={field.name} className={LABEL_CLS}>
                    what would you build?
                  </label>
                  <Textarea
                    id={field.name}
                    name={field.name}
                    value={field.state.value ?? ""}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    rows={5}
                    placeholder="a few sentences"
                    disabled={isPending}
                  />
                </div>
              )}
            </form.Field>
            <Button
              type="submit"
              variant="primary"
              disabled={isPending}
              className="w-full font-display uppercase tracking-wide"
            >
              {isPending && <Spinner />}
              {isPending ? "submitting..." : "submit →"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function fieldErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    return typeof msg === "string" ? msg : "invalid";
  }
  return "invalid";
}
