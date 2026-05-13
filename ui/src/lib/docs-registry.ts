export type DocSection = "operating" | "skills";

export type DocSource = "docs" | "skills";

export type DocEntry = {
  slug: string;
  title: string;
  desc: string;
  section: DocSection;
  source: DocSource;
};

export const DOCS: readonly DocEntry[] = [
  {
    slug: "entity",
    title: "Entity",
    desc: "What MultiAgency LLC is, what it owns, and why the dashboard is shaped this way.",
    section: "operating",
    source: "docs",
  },
  {
    slug: "contributors",
    title: "Contributors",
    desc: "End-to-end onboarding flow: apply → email → mark complete → eligible to pay.",
    section: "operating",
    source: "docs",
  },
  {
    slug: "services-agreement",
    title: "Services agreement",
    desc: "Plain-English summary of the master agreement clauses and the risk each one manages.",
    section: "operating",
    source: "docs",
  },
  {
    slug: "work-order",
    title: "Work order",
    desc: "Per-engagement scope: deliverables, amount, IP terms, payment trigger.",
    section: "operating",
    source: "docs",
  },
  {
    slug: "trezu",
    title: "Trezu",
    desc: "Treasury layer over the Sputnik DAO contract.",
    section: "skills",
    source: "skills",
  },
  {
    slug: "nearn",
    title: "NEARN",
    desc: "Sourcing contributors and managing bounties.",
    section: "skills",
    source: "skills",
  },
] as const;

export function findDoc(slug: string): DocEntry | undefined {
  return DOCS.find((d) => d.slug === slug);
}
