import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button, Card, CardContent, Input, Spinner, Textarea } from "@/components";
import { useApiClient } from "@/lib/api";

export const Route = createFileRoute("/_layout/contact")({
  head: () => ({
    meta: [{ title: "Hire MultiAgency" }, { name: "description", content: "Work with our team." }],
  }),
  component: Contact,
});

const contactSchema = z.object({
  name: z.string().trim().min(1, "name required").max(200, "too long"),
  email: z.string().trim().min(1, "email required").email("not a valid email").max(320, "too long"),
  company: z.string().trim().max(200, "too long").optional(),
  message: z.string().trim().max(4000, "too long").optional(),
});

type ContactValues = z.infer<typeof contactSchema>;

const LABEL_CLS = "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground block";
const ERROR_CLS = "text-sm text-destructive";

function Contact() {
  const apiClient = useApiClient();
  const [submitted, setSubmitted] = useState(false);

  const submitMutation = useMutation({
    mutationFn: async (values: ContactValues) =>
      apiClient.contact.submit({
        name: values.name,
        email: values.email,
        company: values.company || undefined,
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
      company: "",
      message: "",
    } as ContactValues,
    validators: { onChange: contactSchema, onSubmit: contactSchema },
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
              agency · contacted
            </div>
            <h1 className="font-display text-3xl sm:text-4xl uppercase tracking-tight font-extrabold leading-[0.95]">
              Thanks! Let's build.
            </h1>
            <p className="font-mono text-xs leading-relaxed text-muted-foreground">
              Message received. Stay tuned!
            </p>
            <Link
              to="/team"
              className="inline-block font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors"
            >
              Get to know our team →
            </Link>
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
          agency · inquire
        </div>
        <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tight font-black leading-[0.95]">
          Tell us what you need
        </h1>
      </header>

      <Card>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            How can MultiAgency help? We follow up by email.
          </p>

          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              await form.validateAllFields("submit");
              if (form.state.canSubmit) {
                form.handleSubmit();
              }
            }}
          >
            <form.Field name="name">
              {(field) => {
                const err = field.state.meta.errors[0];
                const errId = `${field.name}-error`;
                return (
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
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? errId : undefined}
                    />
                    {err && (
                      <p id={errId} aria-live="polite" className={ERROR_CLS}>
                        {fieldErrorMessage(err)}
                      </p>
                    )}
                  </div>
                );
              }}
            </form.Field>
            <form.Field name="email">
              {(field) => {
                const err = field.state.meta.errors[0];
                const errId = `${field.name}-error`;
                return (
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
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? errId : undefined}
                    />
                    {err && (
                      <p id={errId} aria-live="polite" className={ERROR_CLS}>
                        {fieldErrorMessage(err)}
                      </p>
                    )}
                  </div>
                );
              }}
            </form.Field>
            <form.Field name="company">
              {(field) => {
                const err = field.state.meta.errors[0];
                const errId = `${field.name}-error`;
                return (
                  <div className="space-y-2">
                    <label htmlFor={field.name} className={LABEL_CLS}>
                      company
                    </label>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.state.value ?? ""}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="company or project"
                      disabled={isPending}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? errId : undefined}
                    />
                    {err && (
                      <p id={errId} aria-live="polite" className={ERROR_CLS}>
                        {fieldErrorMessage(err)}
                      </p>
                    )}
                  </div>
                );
              }}
            </form.Field>
            <form.Field name="message">
              {(field) => {
                const err = field.state.meta.errors[0];
                const errId = `${field.name}-error`;
                return (
                  <div className="space-y-2">
                    <label htmlFor={field.name} className={LABEL_CLS}>
                      message
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
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? errId : undefined}
                    />
                    {err && (
                      <p id={errId} aria-live="polite" className={ERROR_CLS}>
                        {fieldErrorMessage(err)}
                      </p>
                    )}
                  </div>
                );
              }}
            </form.Field>
            <Button
              type="submit"
              variant="primary"
              disabled={isPending}
              className="w-full font-display uppercase tracking-wide"
            >
              {isPending && <Spinner />}
              {isPending ? "submitting..." : "send →"}
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
