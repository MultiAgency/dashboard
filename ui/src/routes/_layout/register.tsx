import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { InquiryForm, InquiryPage, InquirySent, InquiryTextField } from "@/components/inquiry-form";
import { useApiClient } from "@/lib/api";
import { isValidNearAccountId } from "@/lib/near-account";
import { getRepoUrl } from "@/lib/repo";

export const Route = createFileRoute("/_layout/register")({
  head: () => ({
    meta: [
      { title: "Register for Updates" },
      { name: "description", content: "Build your agency with us." },
    ],
  }),
  component: RegisterPage,
});

const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name"),
  email: z.string().trim().min(1, "Enter your email").email("Enter a valid email"),
  nearAccountId: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || isValidNearAccountId(v), "Enter a valid NEAR account ID"),
  message: z.string().trim().optional(),
});

type RegisterValues = z.infer<typeof registerSchema>;

function RegisterPage() {
  const apiClient = useApiClient();
  const [submitted, setSubmitted] = useState(false);

  const submitMutation = useMutation({
    mutationFn: async (values: RegisterValues) =>
      apiClient.applications.create({
        kind: "founder",
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
    } as RegisterValues,
    validators: { onChange: registerSchema, onSubmit: registerSchema },
    onSubmit: async ({ value }) => {
      await submitMutation.mutateAsync(value);
    },
  });

  const isPending = submitMutation.isPending;

  if (submitted) {
    return (
      <InquirySent
        title="Thanks, let's build."
        description="We received your details and will follow up by email when the template is ready."
        next={{
          label: "How this Agency works",
          link: { to: "/docs/$slug", params: { slug: "entity" } },
        }}
      />
    );
  }

  return (
    <InquiryPage
      title="Launch your own Agency"
      description="Run your own Organization on the same open-source template. Register and we'll let you know when it's ready."
    >
      <InquiryForm
        id="register-form"
        title="About your Agency"
        description="Tell us why you're interested. We follow up by email."
        isPending={isPending}
        onSubmit={async () => {
          await form.validateAllFields("submit");
          if (form.state.canSubmit) await form.handleSubmit();
        }}
        aside={
          <a
            href={getRepoUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
          >
            Browse the template on GitHub
            <ArrowUpRightIcon aria-hidden className="size-3" />
          </a>
        }
      >
        <form.Field name="name">
          {(field) => (
            <InquiryTextField
              field={field}
              label="Name"
              placeholder="Your name"
              disabled={isPending}
            />
          )}
        </form.Field>
        <form.Field name="email">
          {(field) => (
            <InquiryTextField
              field={field}
              label="Email"
              type="email"
              placeholder="email@example.com"
              disabled={isPending}
            />
          )}
        </form.Field>
        <form.Field name="nearAccountId">
          {(field) => (
            <InquiryTextField
              field={field}
              label="NEAR account"
              placeholder="account.near"
              description="Optional."
              disabled={isPending}
            />
          )}
        </form.Field>
        <form.Field name="message">
          {(field) => (
            <InquiryTextField
              field={field}
              label="Message"
              placeholder="A few sentences about your Agency"
              multiline
              disabled={isPending}
            />
          )}
        </form.Field>
      </InquiryForm>
    </InquiryPage>
  );
}
