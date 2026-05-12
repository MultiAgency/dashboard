import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Button, Card, CardContent } from "@/components";
import { useApiClient } from "@/lib/api";
import { connectNear, sessionQueryOptions } from "@/lib/auth";

const FALLBACK = {
  name: "Agency",
  headline: "Always building. Always open.",
  tagline: "Join our agency. Hire us. Launch your own.",
  contactEmail: null as string | null,
};

const META_DESCRIPTION = "Human-led, AI-native agencies for hire.";

const operatingModel = [
  {
    title: "Structure",
    body: "A registered company with owners, admins, and contributors.",
  },
  {
    title: "Treasury",
    body: "Funds are held on-chain in a Sputnik DAO contract. Every allocation is publicly approved by the finance group.",
  },
  {
    title: "Payouts",
    body: "Opportunities are listed and assigned through NEARN. Payments are budgeted and tracked in this dashboard, managed via Trezu.",
  },
];

const UPSTREAM_DOCS = [
  {
    title: "Trezu",
    body: "How the DAO holds funds and authorizes operators.",
    links: [
      { label: "site", url: "https://trezu.app/" },
      { label: "docs", url: "https://docs.trezu.org/" },
      { label: "skill", url: "/skills/trezu.md" },
    ],
  },
  {
    title: "NEARN",
    body: "Contributor listings, compliance, and payout flow.",
    links: [
      { label: "site", url: "https://nearn.io/" },
      { label: "docs", url: "https://docs.nearn.io/" },
      { label: "skill", url: "/skills/nearn.md" },
    ],
  },
];

export const Route = createFileRoute("/_layout/")({
  head: () => ({
    meta: [{ title: "Home" }, { name: "description", content: META_DESCRIPTION }],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  const authClient = useAuthClient();

  const settingsQuery = useQuery({
    queryKey: ["settings", "public"],
    queryFn: () => apiClient.settings.getPublic(),
    staleTime: 5 * 60_000,
  });
  const s = settingsQuery.data;
  const headline = s?.headline?.trim() || FALLBACK.headline;
  const tagline = s?.tagline?.trim() || FALLBACK.tagline;
  const contactEmail = s?.contactEmail?.trim() || FALLBACK.contactEmail;
  const agencyName = s?.name?.trim() || FALLBACK.name;
  const agencyDocsUrl = s?.docsUrl?.trim() || null;
  const docs = agencyDocsUrl
    ? [
        {
          title: agencyName,
          body: "Entity structure, ownership, and contributor contracts.",
          links: [{ label: "docs", url: agencyDocsUrl }],
        },
        ...UPSTREAM_DOCS,
      ]
    : UPSTREAM_DOCS;

  const connectMutation = useMutation({
    mutationFn: () => connectNear(authClient),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryOptions(authClient).queryKey });
      navigate({ to: "/home" });
    },
    onError: (error: { code?: string; message?: string }) => {
      toast.error(error.message || "Failed to connect NEAR wallet");
    },
  });

  return (
    <div className="space-y-16 pb-12 animate-fade-in">
      <section className="flex flex-col items-center text-center pt-8 sm:pt-16">
        <h1
          className="text-5xl font-semibold tracking-tight sm:text-7xl"
          style={{
            textShadow: "rgba(0,0,0,0.08) 1px 1px 1px, rgba(0,0,0,0.06) 3px 3px 3px",
          }}
        >
          {agencyName}
        </h1>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">{headline}</h2>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          {tagline}
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button asChild>
            <Link to="/projects">view projects</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/apply">express interest</Link>
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <div className="text-center">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Operating Model</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            How accountability, funds, and payouts work.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {operatingModel.map((pillar) => (
            <Card key={pillar.title}>
              <CardContent className="p-5 space-y-3">
                <h3 className="font-semibold tracking-tight">{pillar.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{pillar.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="text-center">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Docs</h2>
          <p className="mt-2 text-sm text-muted-foreground">How the agency operates end-to-end.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {docs.map((doc) => (
            <Card key={doc.title} className="h-full">
              <CardContent className="p-5 space-y-3">
                <h3 className="font-semibold tracking-tight">{doc.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{doc.body}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {doc.links.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground underline"
                    >
                      {link.label}
                      <ArrowUpRight className="w-3 h-3" />
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="flex flex-col items-center text-center gap-3">
        <p className="text-sm text-muted-foreground">
          Operating {agencyName}? Connect a NEAR wallet to enter the admin console.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => connectMutation.mutate()}
            disabled={connectMutation.isPending}
          >
            {connectMutation.isPending ? "connecting..." : "connect NEAR"}
          </Button>
          {contactEmail && (
            <a
              href={`mailto:${contactEmail}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {contactEmail}
            </a>
          )}
        </div>
      </section>
    </div>
  );
}
