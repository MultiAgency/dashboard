import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import trezuLogo from "@/assets/brand/trezu.svg";
import trezuSymbol from "@/assets/brand/trezu-symbol.svg";
import { Badge, Button, Card, CardContent, Empty, EmptyTitle, Skeleton } from "@/components";
import { ReactionDiffusionField } from "@/components/reaction-diffusion-field";
import { UnclaimedState } from "@/components/unclaimed-state";
import { useApiClient } from "@/lib/api";
import { nearnSponsorUrl } from "@/lib/nearn";
import { projectsListQueryOptions, publicSettingsQueryOptions } from "@/lib/queries";
import { getRepoUrl } from "@/lib/repo";
import { trezuTreasuryUrl } from "@/lib/trezu";
import { Route as RootRoute } from "../__root";

const META_DESCRIPTION = "Human-led, AI-native agencies for hire.";

const FALLBACK = {
  name: "MultiAgency",
  headline: "Open Books · Open Source · Open Doors",
  tagline: "The future of work is near…",
};

const STANDARD = [
  { label: "Website", note: "landing, work, contact" },
  { label: "Treasury", note: "payouts, permissions, policies" },
  { label: "Projects", note: "nearn listings, live" },
  { label: "Dashboard", note: "applications, contributors, billing" },
];

export const Route = createFileRoute("/_layout/")({
  head: () => ({
    meta: [{ name: "description", content: META_DESCRIPTION }],
  }),
  beforeLoad: async ({ context }) => {
    // Non-fatal prefetch — landing page projects, so SSR renders cards or the empty state.
    await context.queryClient
      .ensureQueryData(projectsListQueryOptions(context.apiClient))
      .catch(() => {});
  },
  component: Landing,
});

type LandingProject = {
  id: string;
  slug: string;
  title: string;
  nearnListing: unknown | null;
};

function Landing() {
  const apiClient = useApiClient();
  const loaderData = RootRoute.useLoaderData();
  const assetsUrl = loaderData?.assetsUrl ?? "";

  const settingsQuery = useQuery(publicSettingsQueryOptions(apiClient));
  const projectsQuery = useQuery(projectsListQueryOptions(apiClient));

  const s = settingsQuery.data;
  const agencyName = s?.name?.trim() || FALLBACK.name;
  const headline = s?.headline?.trim() || FALLBACK.headline;
  const tagline = s?.tagline?.trim() || FALLBACK.tagline;

  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.title;
    document.title = `${agencyName} — ${tagline}`;
    return () => {
      document.title = prev;
    };
  }, [agencyName, tagline]);
  const description = s?.description?.trim() || null;
  const contactEmail = s?.contactEmail?.trim() || null;
  const docsUrl = s?.docsUrl?.trim() || null;
  const isPlaceholder = !!s?.isPlaceholder;
  const treasuryUrl = s?.daoAccountId ? trezuTreasuryUrl(s.daoAccountId) : null;
  const repositoryUrl = getRepoUrl();
  const sponsorUrl = s?.nearnAccountId ? nearnSponsorUrl(s.nearnAccountId) : null;

  if (isPlaceholder) {
    return (
      <UnclaimedState title="MultiAgency">
        Fork the template to deploy your own agency.
      </UnclaimedState>
    );
  }

  const projects = (projectsQuery.data?.data ?? []) as LandingProject[];
  const visibleProjects = projects.slice(0, 6);
  const hasMore = projects.length > 6;

  return (
    <div className="space-y-16 pb-12 animate-fade-in">
      <section className="relative min-h-[70vh] flex flex-col justify-center -mt-6 sm:-mt-10 py-12 sm:py-16 overflow-hidden -mx-4 sm:-mx-6 px-4 sm:px-6">
        <ReactionDiffusionField />
        <div className="relative flex flex-col items-start space-y-6 text-left">
          <div className="w-full pl-3 pr-3">
            <h1
              className="font-black uppercase leading-[0.88] break-words max-w-full text-4xl sm:text-6xl md:text-7xl lg:text-8xl"
              style={{
                fontFamily: '"Bungee", "Impact", "Arial Black", sans-serif',
                letterSpacing: "-0.04em",
                fontFeatureSettings: '"kern", "liga"',
                WebkitFontSmoothing: "subpixel-antialiased",
                MozOsxFontSmoothing: "auto",
                textRendering: "geometricPrecision",
              }}
            >
              {agencyName}
            </h1>
            <div className="mt-3 flex items-center gap-3">
              <span className="font-mono font-semibold text-sm sm:text-base uppercase tracking-[0.22em] text-accent">
                Build Agencies Together
              </span>
              <div className="flex-1 h-px bg-accent/80" />
              <span className="font-mono font-semibold text-[10px] uppercase tracking-[0.22em] text-accent tabular-nums">
                v0.1
              </span>
            </div>
          </div>
          <p className="max-w-2xl pl-3 font-display text-xl sm:text-2xl uppercase font-extrabold tracking-tight leading-tight">
            {headline}
          </p>
          {description && (
            <p className="max-w-2xl pl-3 text-sm leading-relaxed text-foreground/80">
              {description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 pl-3 pt-2">
            <Button asChild variant="outline" className="font-display uppercase tracking-wide">
              <Link to="/apply">join →</Link>
            </Button>
            <Button asChild variant="primary" className="font-display uppercase tracking-wide">
              <Link to="/contact">hire →</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="relative -mt-16 bg-foreground text-background -mx-4 sm:-mx-6 px-4 sm:px-6 py-10 sm:py-14">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-start pl-3 pr-3">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-background/70">
                agency · template
              </span>
              <span className="font-mono font-semibold text-[10px] uppercase tracking-[0.22em] bg-accent text-accent-foreground px-2 py-0.5">
                coming soon
              </span>
            </div>
            <h2 className="font-display text-4xl sm:text-6xl uppercase tracking-tight font-black leading-[0.92]">
              Launch Your Own Agency
            </h2>
            <div className="h-px w-full bg-background/25" />
            <p className="max-w-md text-base leading-relaxed text-background/80 sm:text-lg">
              Same blueprint. One command. Your business.
            </p>
            <div className="pt-2">
              <Button asChild variant="primary" className="font-display uppercase tracking-wide">
                <Link to="/register">register →</Link>
              </Button>
            </div>
          </div>
          <div className="border-2 border-background">
            <div className="border-b-2 border-background bg-accent text-accent-foreground px-4 py-2 font-mono font-semibold text-[11px] uppercase tracking-[0.22em]">
              standard issue
            </div>
            <div className="divide-y-2 divide-background">
              {STANDARD.map((item, i) => (
                <div key={item.label} className="flex items-center gap-4 px-4 py-4">
                  <span className="font-display text-3xl sm:text-4xl font-black tabular-nums leading-none text-background/25 shrink-0 w-12">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="space-y-1">
                    <div className="font-display text-lg uppercase tracking-tight font-extrabold leading-none">
                      {item.label}
                    </div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-background/55">
                      {item.note}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="pl-3 pr-3 space-y-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            opportunities
          </div>
          <h2 className="font-display text-3xl sm:text-5xl font-black uppercase tracking-tight">
            Our Work
          </h2>
        </div>
        {projectsQuery.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <ProjectCardSkeleton key={i} />
            ))}
          </div>
        ) : projectsQuery.isError ? (
          <p
            role="alert"
            className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground"
          >
            could not load — try again
          </p>
        ) : projects.length === 0 ? (
          <Empty className="border-2 border-dashed border-border/40">
            <EmptyTitle className="font-display text-lg uppercase tracking-tight text-muted-foreground">
              no public projects yet
            </EmptyTitle>
          </Empty>
        ) : (
          <>
            <div
              className={`grid gap-4 ${visibleProjects.length > 1 ? "sm:grid-cols-2" : "sm:grid-cols-1 sm:max-w-md"}`}
            >
              {visibleProjects.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button asChild variant="outline" className="font-display uppercase tracking-wide">
                  <Link to="/work">explore →</Link>
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="space-y-6">
        <div className="pl-3 pr-3 space-y-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            apparatus
          </div>
          <h2 className="font-display text-3xl sm:text-5xl font-black uppercase tracking-tight">
            Featuring
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <StackCard
            label="treasury"
            tag="on-chain"
            name="Trezu"
            iconSrc={trezuSymbol}
            logoSrc={trezuLogo}
            logoAlt="Trezu"
            body="Manage your team's capital in minutes from a single dashboard without ever giving up your keys."
            url="https://trezu.app/"
            host="trezu.app"
          />
          <StackCard
            label="bounties"
            tag="live listings"
            name="NEARN"
            logoSrc={`${assetsUrl}/static/svg/nearn.svg`}
            logoAlt="NEARN"
            logoHeightClass="h-9"
            body="NEARN connects projects (sponsors) with skilled contributors to complete bounties, projects, and tasks in the NEAR ecosystem."
            url="https://nearn.io/"
            host="nearn.io"
          />
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 pt-8 border-t-2 border-foreground/15">
        {treasuryUrl && <FooterLink href={treasuryUrl}>open books →</FooterLink>}
        <FooterLink href={repositoryUrl}>open source →</FooterLink>
        {sponsorUrl && <FooterLink href={sponsorUrl}>open doors →</FooterLink>}
        <Link
          to="/docs"
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          docs →
        </Link>
        <FooterLink href="https://x.com/_multiagency">x →</FooterLink>
        {docsUrl && <FooterLink href={docsUrl}>docs site →</FooterLink>}
        {contactEmail && (
          <a
            href={`mailto:${contactEmail}`}
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          >
            {contactEmail}
          </a>
        )}
      </footer>
    </div>
  );
}

function ProjectCard({ project }: { project: LandingProject }) {
  const hasBounty = !!project.nearnListing;
  return (
    <Card className="flex flex-col border-2 border-foreground">
      <CardContent className="p-4 flex-1 flex flex-col gap-3">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="truncate">@{project.slug}</span>
          <span>project</span>
        </div>
        <h3 className="font-display text-xl uppercase tracking-tight font-extrabold leading-tight break-words">
          {project.title}
        </h3>
        {hasBounty && <Badge variant="accent">bounty</Badge>}
        <div className="mt-auto pt-2">
          <Button asChild variant="outline" className="w-full font-display uppercase tracking-wide">
            <Link to="/work">open →</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectCardSkeleton() {
  return (
    <Card className="flex flex-col border-2 border-foreground">
      <CardContent className="p-4 flex-1 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-6 w-3/4" />
        <div className="mt-auto pt-2">
          <Skeleton className="h-10 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}

function StackCard({
  label,
  tag,
  name,
  iconSrc,
  logoSrc,
  logoAlt,
  logoHeightClass = "h-7",
  body,
  url,
  host,
}: {
  label: string;
  tag: string;
  name: string;
  iconSrc?: string;
  logoSrc?: string;
  logoAlt?: string;
  logoHeightClass?: string;
  body: string;
  url: string;
  host: string;
}) {
  return (
    <Card className="flex flex-col border-2 border-foreground">
      <CardContent className="p-4 flex-1 flex flex-col gap-4">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span>{label}</span>
          <span>{tag}</span>
        </div>
        {logoSrc ? (
          <h3 className="h-12 flex items-center gap-3 leading-none">
            {iconSrc && (
              <img src={iconSrc} alt="" aria-hidden="true" className="h-12 w-12 shrink-0" />
            )}
            <img
              src={logoSrc}
              alt={logoAlt ?? name}
              className={`${logoHeightClass} w-auto dark:invert`}
            />
          </h3>
        ) : (
          <h3 className="font-display text-2xl uppercase tracking-tight font-extrabold leading-tight">
            {name}
          </h3>
        )}
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
        <div className="mt-auto pt-2">
          <Button asChild variant="outline" className="font-display uppercase tracking-wide w-full">
            <a href={url} target="_blank" rel="noopener noreferrer">
              {host} →
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
    >
      {children}
    </a>
  );
}
