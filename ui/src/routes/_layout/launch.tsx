import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button, Card, CardContent, Input, Spinner, Textarea } from "@/components";
import { useApiClient } from "@/lib/api";

export const Route = createFileRoute("/_layout/launch")({
  head: () => ({
    meta: [
      { title: "Launch Your Own Agency" },
      { name: "description", content: "Replicate the MultiAgency model." },
    ],
  }),
  component: LaunchPage,
});

const launchSchema = z.object({
  name: z.string().trim().min(1, "name required"),
  email: z.string().trim().min(1, "email required").email("not a valid email"),
  nearAccountId: z.string().trim().optional(),
  message: z.string().trim().optional(),
});

type LaunchValues = z.infer<typeof launchSchema>;

const LABEL_CLS = "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground block";
const ERROR_CLS = "text-sm text-destructive";

function LaunchPage() {
  const apiClient = useApiClient();
  const [submitted, setSubmitted] = useState(false);

  const submitMutation = useMutation({
    mutationFn: async (values: LaunchValues) =>
      apiClient.applications.create({
        kind: "replicate",
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
    } as LaunchValues,
    validators: { onChange: launchSchema },
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
              agency · interest received
            </div>
            <h1 className="font-display text-3xl sm:text-4xl uppercase tracking-tight font-extrabold leading-[0.95]">
              Thanks — we'll be in touch.
            </h1>
            <p className="font-mono text-xs leading-relaxed text-muted-foreground">
              Message received. We'll follow up by email with the agency setup playbook and the
              template documents.
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
          agency · launch
        </div>
        <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tight font-black leading-[0.95]">
          Launch Your Own Agency
        </h1>
      </header>

      <Card>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Same stack — LLC, Sputnik DAO, NEARN, this dashboard. Tell us what you'd run. We will
            follow up.
          </p>

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
                    what would you run?
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
