import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { InquiryForm, InquiryPage, InquirySent, InquiryTextField } from "@/components/inquiry-form";
import { useApiClient } from "@/lib/api";

export const Route = createFileRoute("/_layout/contact")({
  head: () => ({
    meta: [{ title: "Hire MultiAgency" }, { name: "description", content: "Work with our team." }],
  }),
  component: Contact,
});

const contactSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(200, "Keep it under 200 characters"),
  email: z
    .string()
    .trim()
    .min(1, "Enter your email")
    .email("Enter a valid email")
    .max(320, "Keep it under 320 characters"),
  company: z.string().trim().max(200, "Keep it under 200 characters").optional(),
  message: z.string().trim().max(4000, "Keep it under 4000 characters").optional(),
});

type ContactValues = z.infer<typeof contactSchema>;

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
      <InquirySent
        title="Thanks, let's build."
        description="We received your message and will follow up by email."
        next={{ label: "Get to know our team", link: { to: "/team" } }}
      />
    );
  }

  return (
    <InquiryPage
      title="Hire MultiAgency"
      description="Tell us what you need. Clients see every Project and Billing, and steer the plan as work moves."
    >
      <InquiryForm
        id="contact-form"
        title="Your project"
        description="How can MultiAgency help? We follow up by email."
        isPending={isPending}
        onSubmit={async () => {
          await form.validateAllFields("submit");
          if (form.state.canSubmit) await form.handleSubmit();
        }}
        aside={
          <Link to="/work" className="underline underline-offset-4 hover:text-foreground">
            See our work
          </Link>
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
        <form.Field name="company">
          {(field) => (
            <InquiryTextField
              field={field}
              label="Company"
              placeholder="Company or project"
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
              placeholder="A few sentences about what you need"
              multiline
              disabled={isPending}
            />
          )}
        </form.Field>
      </InquiryForm>
    </InquiryPage>
  );
}
