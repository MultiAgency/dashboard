import { createFileRoute, Link } from "@tanstack/react-router";
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

const SECTION_EYEBROW: Record<DocSection, string> = {
  operating: "handbook · model",
  skills: "handbook · skills",
};

function DocsIndex() {
  const grouped = SECTION_ORDER.map((section) => ({
    section,
    entries: DOCS.filter((d) => d.section === section),
  }));

  return (
    <div className="space-y-12 pb-12 animate-fade-in">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          agency · docs
        </div>
        <h1 className="font-display text-4xl sm:text-6xl font-black uppercase leading-none tracking-tight">
          Docs
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          How MultiAgency operates and the integrations it runs on.
        </p>
      </header>

      {grouped.map(({ section, entries }) => (
        <section key={section} className="space-y-4">
          <div className="flex items-baseline justify-between gap-3 border-b-2 border-foreground/15 pb-2">
            <h2 className="font-display text-xl uppercase tracking-tight font-extrabold">
              {SECTION_TITLE[section]}
            </h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {SECTION_EYEBROW[section]}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {entries.map((d) => (
              <Link
                key={d.slug}
                to="/docs/$slug"
                params={{ slug: d.slug }}
                className="border-2 border-border flex flex-col bg-card hover:bg-accent/20 transition-colors"
              >
                <div className="p-4 flex-1 flex flex-col gap-3">
                  <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <span>{section === "skills" ? "skill" : "model"}</span>
                    <span>md</span>
                  </div>
                  <h3 className="font-display text-xl uppercase tracking-tight font-extrabold leading-tight">
                    {d.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{d.desc}</p>
                  <div className="mt-auto pt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    read →
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
