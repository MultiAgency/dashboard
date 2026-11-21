export type DocSection = "operating" | "platform" | "skills";

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
    desc: "What MultiAgency LLC is, what a workspace is, and why the dashboard is shaped this way.",
    section: "operating",
    source: "docs",
  },
  {
    slug: "contributors",
    title: "Contributors",
    desc: "End-to-end onboarding flow: apply, email, signed agreement on file, then eligible to pay.",
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
    slug: "platform",
    title: "Platform",
    desc: "Scoped authority for agents: policies, grants, caps and freeze, above the NEAR Intents Verifier.",
    section: "platform",
    source: "docs",
  },
  {
    slug: "treasury-app",
    title: "Treasury app",
    desc: "Agents propose, owners approve or delegate to autopilot.",
    section: "platform",
    source: "docs",
  },
  {
    slug: "desk",
    title: "Desk",
    desc: "Signed job terms become a payment agent that can only pay what was agreed.",
    section: "platform",
    source: "docs",
  },
  {
    slug: "extents",
    title: "NEAR Extents",
    desc: "Planned: shared objectives across several parties, settled on the Verifier.",
    section: "platform",
    source: "docs",
  },
  {
    slug: "glossary",
    title: "Glossary",
    desc: "Policy, grant, cap, freeze, objective and the other terms in one place.",
    section: "platform",
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
