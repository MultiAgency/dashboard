import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, Input } from "@/components";
import { Field } from "@/components/admin-form";
import { useApiClient } from "@/lib/use-api-client";

type Kind = "replicate" | "contributor";

const KIND_DESCRIPTIONS: Record<Kind, { title: string; body: string }> = {
  replicate: {
    title: "Launch your own agency",
    body: "Replicate the framework — LLC pattern, Trezu treasury, NEARN contributors, this dashboard. Tell us about the opportunity you'd run.",
  },
  contributor: {
    title: "Join as a contributor",
    body: "We source contributors through NEARN. Tell us what you can build, and we'll get back to you when there's a fit.",
  },
};

export const Route = createFileRoute("/_layout/apply")({
  head: () => ({
    meta: [
      { title: "Express Interest" },
      {
        name: "description",
        content: "Apply to launch your own agency or join our agency as a contributor.",
      },
    ],
  }),
  component: ApplyPage,
});

function ApplyPage() {
  const apiClient = useApiClient();
  const [kind, setKind] = useState<Kind>("contributor");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [nearAccountId, setNearAccountId] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submitMutation = useMutation({
    mutationFn: async () =>
      apiClient.applications.create({
        kind,
        name: name.trim(),
        email: email.trim(),
        nearAccountId: nearAccountId.trim() || undefined,
        message: message.trim() || undefined,
      }),
    onSuccess: () => {
      setSubmitted(true);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to submit");
    },
  });

  const isPending = submitMutation.isPending;
  const canSubmit = name.trim().length > 0 && email.trim().length > 0 && !isPending;

  if (submitted) {
    return (
      <div className="max-w-xl mx-auto space-y-6 pt-8">
        <Card>
          <CardContent className="p-8 space-y-4 text-center">
            <Badge variant="outline">received</Badge>
            <h1 className="text-2xl font-semibold tracking-tight">Thanks — we'll be in touch.</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your interest is logged. We review applications regularly and respond when there's a
              clear next step.
            </p>
            <div>
              <Button asChild variant="outline" size="sm">
                <Link to="/">back to home</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const description = KIND_DESCRIPTIONS[kind];

  return (
    <div className="max-w-xl mx-auto space-y-6 pt-4">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Express interest</h1>
        <p className="text-sm text-muted-foreground">
          Two paths. Pick the one that fits, then tell us a bit about you.
        </p>
      </header>

      <div className="grid gap-2 sm:grid-cols-2">
        {(Object.keys(KIND_DESCRIPTIONS) as Kind[]).map((k) => {
          const active = k === kind;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`text-left p-4 rounded-sm border-2 transition-colors ${
                active
                  ? "border-foreground bg-muted/30"
                  : "border-border bg-card hover:border-foreground/40"
              }`}
            >
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {k === "replicate" ? "Replicate" : "Contribute"}
              </div>
              <div className="font-semibold text-sm mt-1">{KIND_DESCRIPTIONS[k].title}</div>
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">{description.body}</p>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) submitMutation.mutate();
            }}
          >
            <Field label="name" htmlFor="apply-name">
              <Input
                id="apply-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="your name"
                required
                disabled={isPending}
              />
            </Field>
            <Field label="email" htmlFor="apply-email">
              <Input
                id="apply-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                required
                disabled={isPending}
              />
            </Field>
            <Field label="near account (optional)" htmlFor="apply-near">
              <Input
                id="apply-near"
                value={nearAccountId}
                onChange={(e) => setNearAccountId(e.target.value)}
                placeholder="account.near"
                disabled={isPending}
              />
            </Field>
            <Field
              label={kind === "replicate" ? "what would you run?" : "what would you build?"}
              htmlFor="apply-message"
            >
              <textarea
                id="apply-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                disabled={isPending}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="a few sentences"
              />
            </Field>
            <Button type="submit" disabled={!canSubmit} className="w-full">
              {isPending ? "submitting..." : "submit"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
