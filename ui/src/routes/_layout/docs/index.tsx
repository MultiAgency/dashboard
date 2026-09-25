import { ArrowRightIcon } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components";
import { PageHeader, SectionHeader } from "@/components/page-header";
import { DOCS, type DocSection } from "@/lib/docs-registry";

export const Route = createFileRoute("/_layout/docs/")({
  head: () => ({
    meta: [
      { title: "Docs" },
      { name: "description", content: "How MultiAgency operates and the integrations it runs on." },
    ],
  }),
  component: DocsIndex,
});

const SECTION_ORDER: DocSection[] = ["operating", "skills"];

const SECTION_TITLE: Record<DocSection, string> = {
  operating: "Operating model",
  skills: "Integration skills",
};

const SECTION_DESCRIPTION: Record<DocSection, string> = {
  operating: "How the Agency is set up and how work gets paid.",
  skills: "Guides for the integrations the platform runs on.",
};

function DocsIndex() {
  const grouped = SECTION_ORDER.map((section) => ({
    section,
    entries: DOCS.filter((d) => d.section === section),
  }));

  return (
    <div className="flex animate-fade-in flex-col gap-10">
      <PageHeader
        title="Docs"
        description="How MultiAgency operates and the integrations it runs on."
      />

      {grouped.map(({ section, entries }) => (
        <section key={section} className="flex flex-col gap-4">
          <SectionHeader
            title={SECTION_TITLE[section]}
            description={SECTION_DESCRIPTION[section]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {entries.map((d) => (
              <Link
                key={d.slug}
                to="/docs/$slug"
                params={{ slug: d.slug }}
                className="flex outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Card variant="interactive" className="w-full">
                  <CardHeader>
                    <CardTitle>
                      <h3>{d.title}</h3>
                    </CardTitle>
                    <CardDescription>{d.desc}</CardDescription>
                    <CardAction>
                      <ArrowRightIcon aria-hidden className="size-4 text-muted-foreground" />
                    </CardAction>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
