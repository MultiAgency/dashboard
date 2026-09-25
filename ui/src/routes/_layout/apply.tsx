import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { InquiryForm, InquiryPage, InquirySent, InquiryTextField } from "@/components/inquiry-form";
import { useApiClient } from "@/lib/api";
import { isValidNearAccountId } from "@/lib/near-account";
import { nearnSponsorUrl } from "@/lib/nearn";
import { publicSettingsQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/apply")({
  head: () => ({
    meta: [
      { title: "Join MultiAgency" },
      { name: "description", content: "Apply to become a paid contributor." },
    ],
  }),
  component: ApplyPage,
});

const applySchema = z.object({
  name: z.string().trim().min(1, "Enter your name"),
  email: z.string().trim().min(1, "Enter your email").email("Enter a valid email"),
  nearAccountId: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || isValidNearAccountId(v), "Enter a valid NEAR account ID"),
  message: z.string().trim().optional(),
});

type ApplyValues = z.infer<typeof applySchema>;

function ApplyPage() {
  const apiClient = useApiClient();
  const settingsQuery = useQuery(publicSettingsQueryOptions(apiClient));
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
    validators: { onChange: applySchema, onSubmit: applySchema },
    onSubmit: async ({ value }) => {
      await submitMutation.mutateAsync(value);
    },
  });

  const isPending = submitMutation.isPending;

  if (submitted) {
    return (
      <InquirySent
        title="Thanks, let's build."
        description="We received your application and will follow up by email."
        next={{
          label: "How to get involved",
          link: { to: "/docs/$slug", params: { slug: "contributors" } },
        }}
      />
    );
  }

  return (
    <InquiryPage
      title="Join as a contributor"
      description="Tell us about your expertise. Assigned work shows up in My work, and you get paid through DAO proposals."
    >
      <InquiryForm
        id="apply-form"
        title="About you"
        description="We follow up by email."
        isPending={isPending}
        onSubmit={async () => {
          await form.validateAllFields("submit");
          if (form.state.canSubmit) await form.handleSubmit();
        }}
        aside={
          nearnUrl && (
            <a
              href={nearnUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
            >
              Browse open work on NEARN
              <ArrowUpRightIcon aria-hidden className="size-3" />
            </a>
          )
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
              description="Optional. Used for payouts."
              disabled={isPending}
            />
          )}
        </form.Field>
        <form.Field name="message">
          {(field) => (
            <InquiryTextField
              field={field}
              label="Message"
              placeholder="A few sentences about your skills and interests"
              multiline
              disabled={isPending}
            />
          )}
        </form.Field>
      </InquiryForm>
    </InquiryPage>
  );
}
