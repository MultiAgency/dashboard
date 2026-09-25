import type { Icon } from "@phosphor-icons/react";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  BuildingsIcon,
  CalendarCheckIcon,
  FolderSimpleIcon,
  GithubLogoIcon,
  LightbulbIcon,
  ListChecksIcon,
  ReceiptIcon,
  TreeStructureIcon,
  UserPlusIcon,
  UsersThreeIcon,
  VaultIcon,
  WalletIcon,
  XLogoIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef } from "react";
import trezuLogo from "@/assets/brand/trezu.svg";
import trezuSymbol from "@/assets/brand/trezu-symbol.svg";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Separator,
  Skeleton,
} from "@/components";
import { LoadError } from "@/components/load-error";
import { SectionHeader } from "@/components/page-header";
import { useApiClient } from "@/lib/api";
import { projectsListQueryOptions } from "@/lib/queries";
import { getRepoUrl } from "@/lib/repo";
import { cn } from "@/lib/utils";
import { Route as RootRoute } from "../__root";

const RD_W = 200;
const RD_H = 130;
const RD_STEPS_PER_FRAME = 10;
const RD_SETTLE_STEPS = 1800;
const DOT_STRIDE = 2;
const DOT_LEVELS = 5;

const RD_PRESETS = {
  worms: { du: 0.16, dv: 0.08, f: 0.06, k: 0.062 },
  solitons: { du: 0.16, dv: 0.08, f: 0.0367, k: 0.0649 },
  mitosis: { du: 0.16, dv: 0.08, f: 0.014, k: 0.054 },
  spots: { du: 0.16, dv: 0.08, f: 0.062, k: 0.0609 },
  coral: { du: 0.16, dv: 0.08, f: 0.039, k: 0.058 },
  waves: { du: 0.16, dv: 0.08, f: 0.026, k: 0.051 },
  bacteria: { du: 0.16, dv: 0.08, f: 0.078, k: 0.061 },
} as const;

type RdPreset = keyof typeof RD_PRESETS;

function ReactionDiffusionField({
  preset = "worms",
  className,
}: {
  preset?: RdPreset;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { du: DU, dv: DV, f: F, k: K } = RD_PRESETS[preset];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const N = RD_W * RD_H;

    let u = new Float32Array(N).fill(1);
    let v = new Float32Array(N).fill(0);
    let un = new Float32Array(N).fill(1);
    let vn = new Float32Array(N).fill(0);

    for (let s = 0; s < 48; s++) {
      const cx = 6 + Math.floor(Math.random() * (RD_W - 12));
      const cy = 6 + Math.floor(Math.random() * (RD_H - 12));
      const r = 2 + Math.floor(Math.random() * 3);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (dx * dx + dy * dy <= r * r && x >= 0 && x < RD_W && y >= 0 && y < RD_H) {
            u[y * RD_W + x] = 0.25 + Math.random() * 0.1;
            v[y * RD_W + x] = 0.5 + Math.random() * 0.1;
          }
        }
      }
    }

    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    const probeCtx = probe.getContext("2d", { willReadFrequently: true });
    const readToken = (varName: string): string => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      if (!probeCtx || !raw) return "rgb(0 0 0)";
      probeCtx.clearRect(0, 0, 1, 1);
      probeCtx.fillStyle = raw;
      probeCtx.fillRect(0, 0, 1, 1);
      const [r, g, b] = probeCtx.getImageData(0, 0, 1, 1).data;
      return `rgb(${r} ${g} ${b})`;
    };
    let dotColor = readToken("--muted-foreground");
    let peakColor = readToken("--primary");

    const themeObserver = new MutationObserver(() => {
      dotColor = readToken("--muted-foreground");
      peakColor = readToken("--primary");
      if (!running) render();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });

    const cols = Math.floor(RD_W / DOT_STRIDE);
    const rows = Math.floor(RD_H / DOT_STRIDE);
    let cell = 1;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      cell = Math.max(canvas.width / cols, canvas.height / rows);
      if (!running) render();
    };

    const step = () => {
      for (let y = 1; y < RD_H - 1; y++) {
        const row = y * RD_W;
        for (let x = 1; x < RD_W - 1; x++) {
          const i = row + x;
          const lu = u[i - 1] + u[i + 1] + u[i - RD_W] + u[i + RD_W] - 4 * u[i];
          const lv = v[i - 1] + v[i + 1] + v[i - RD_W] + v[i + RD_W] - 4 * v[i];
          const uvv = u[i] * v[i] * v[i];
          un[i] = u[i] + DU * lu - uvv + F * (1 - u[i]);
          vn[i] = v[i] + DV * lv + uvv - (F + K) * v[i];
        }
      }
      for (let x = 0; x < RD_W; x++) {
        un[x] = u[x];
        vn[x] = v[x];
        un[(RD_H - 1) * RD_W + x] = u[(RD_H - 1) * RD_W + x];
        vn[(RD_H - 1) * RD_W + x] = v[(RD_H - 1) * RD_W + x];
      }
      for (let y = 0; y < RD_H; y++) {
        un[y * RD_W] = u[y * RD_W];
        vn[y * RD_W] = v[y * RD_W];
        un[y * RD_W + RD_W - 1] = u[y * RD_W + RD_W - 1];
        vn[y * RD_W + RD_W - 1] = v[y * RD_W + RD_W - 1];
      }
      [u, un] = [un, u];
      [v, vn] = [vn, v];
    };

    const buckets: number[][] = Array.from({ length: DOT_LEVELS }, () => []);
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const bucket of buckets) bucket.length = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const level = Math.floor(
            Math.min(0.999, v[r * DOT_STRIDE * RD_W + c * DOT_STRIDE] * 2.05) * DOT_LEVELS,
          );
          if (level > 0) buckets[level]!.push(c, r);
        }
      }
      for (let level = 1; level < DOT_LEVELS; level++) {
        const bucket = buckets[level]!;
        if (bucket.length === 0) continue;
        const peak = level === DOT_LEVELS - 1;
        const size = cell * (0.25 + 0.5 * (level / (DOT_LEVELS - 1)));
        const offset = (cell - size) / 2;
        ctx.fillStyle = peak ? peakColor : dotColor;
        ctx.globalAlpha = peak ? 0.9 : 0.25 + 0.2 * level;
        for (let i = 0; i < bucket.length; i += 2) {
          ctx.fillRect(bucket[i]! * cell + offset, bucket[i + 1]! * cell + offset, size, size);
        }
      }
      ctx.globalAlpha = 1;
    };

    let running = false;
    let visible = true;
    let rafId = 0;
    const tick = () => {
      for (let s = 0; s < RD_STEPS_PER_FRAME; s++) step();
      render();
      rafId = requestAnimationFrame(tick);
    };
    const sync = () => {
      const shouldRun = !reducedMotion && visible && document.visibilityState === "visible";
      if (shouldRun && !running) {
        running = true;
        rafId = requestAnimationFrame(tick);
      } else if (!shouldRun && running) {
        running = false;
        cancelAnimationFrame(rafId);
      }
    };

    if (reducedMotion) {
      for (let s = 0; s < RD_SETTLE_STEPS; s++) step();
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      sync();
    });
    intersectionObserver.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    sync();

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      themeObserver.disconnect();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [DU, DV, F, K]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn(className ?? "pointer-events-none absolute inset-0 size-full")}
    />
  );
}

const LANDING = {
  name: "MultiAgency",
  tagline: "Open books for agency work",
  description:
    "Agencies run transparent client work on chain. Clients see and steer where their money goes.",
};

type Feature = { icon: Icon; title: string; body: string };

const FOR_CLIENTS: Feature[] = [
  {
    icon: UsersThreeIcon,
    title: "Invite your whole team",
    body: "Colleagues sign in with email. No wallet needed.",
  },
  {
    icon: ReceiptIcon,
    title: "See every Project and Billing",
    body: "Every Project shared with you, and every Billing paid against it.",
  },
  {
    icon: WalletIcon,
    title: "Prepay capacity",
    body: "Make a Prepayment and follow your Prepaid balance as work lands.",
  },
  {
    icon: ListChecksIcon,
    title: "Agree the plan, then steer it",
    body: "Agree an Allocation plan with your Agency and propose Change orders when priorities move.",
  },
  {
    icon: LightbulbIcon,
    title: "Ideas, reports and agent links",
    body: "Submit ideas, generate and save reports, and give your agents a scoped link.",
  },
];

const FOR_AGENCIES: Feature[] = [
  {
    icon: BuildingsIcon,
    title: "Create an Organization in seconds",
    body: "Start with a name. Add members and roles as you grow.",
  },
  {
    icon: VaultIcon,
    title: "Connect a Trezu treasury",
    body: "Link your Agency DAO when you're ready for money features.",
  },
  {
    icon: UserPlusIcon,
    title: "Onboard Clients in one step",
    body: "One invite gives the Client a shared Engagement with your Agency.",
  },
  {
    icon: CalendarCheckIcon,
    title: "Prepayments that plan themselves",
    body: "Record a Prepayment and the Allocation plan applies to each monthly budget.",
  },
  {
    icon: TreeStructureIcon,
    title: "Subcontract in one step",
    body: "Hand a Project to another Agency. They pay their contributors from their own DAO.",
  },
];

const STEPS = [
  { title: "Create an Organization", body: "Your Agency's home for members, roles and settings." },
  {
    title: "Start an Engagement",
    body: "Invite a Client and share the Projects you work on together.",
  },
  {
    title: "Agree the plan",
    body: "Prepayments and an Allocation plan set each month's Budget entries.",
  },
  {
    title: "Work and bill on chain",
    body: "Each Billing is a transfer proposal from the Agency DAO.",
  },
];

const TEMPLATE = [
  { label: "Website", note: "Landing, work and contact pages" },
  { label: "Treasury", note: "Payouts, permissions and policies" },
  { label: "Projects", note: "Live NEARN listings" },
  { label: "Dashboard", note: "Clients, contributors and billing" },
];

export const Route = createFileRoute("/_layout/")({
  loader: async ({ context }) => {
    await context.queryClient
      .ensureQueryData(projectsListQueryOptions(context.apiClient))
      .catch(() => null);

    return null;
  },
  head: () => ({
    meta: [
      { title: `${LANDING.name} — ${LANDING.tagline}` },
      { name: "description", content: LANDING.description },
    ],
  }),
  component: Landing,
});

type LandingProject = {
  id: string;
  slug: string;
  title: string;
  nearnListing: unknown | null;
};

function Landing() {
  const loaderData = RootRoute.useLoaderData();
  const assetsUrl = loaderData?.runtimeConfig?.assetsUrl ?? "";
  const repositoryUrl = getRepoUrl();

  return (
    <div className="flex animate-fade-in flex-col gap-16">
      <Hero />

      <section aria-labelledby="audiences" className="flex flex-col gap-6">
        <SectionHeader
          id="audiences"
          title="One workspace, both sides of the work"
          description="Clients and Agencies share the same Projects, plans and Billings."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <FeatureCard
            title="For Clients"
            description="See and steer where your money goes."
            features={FOR_CLIENTS}
          />
          <FeatureCard
            title="For Agencies"
            description="Run transparent client work from one place."
            features={FOR_AGENCIES}
          />
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <SectionHeader
          title="How it works"
          description="Four steps from sign-up to verifiable payouts."
        />
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex">
              <Card size="sm" className="w-full">
                <CardHeader>
                  <CardDescription>Step {index + 1}</CardDescription>
                  <CardTitle>
                    <h3>{step.title}</h3>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs/relaxed text-muted-foreground">{step.body}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-6">
        <SectionHeader
          title="Open books"
          description="Billings are DAO transfer proposals, so every payout is verifiable on chain. Every Client of a Project sees its Billings."
          actions={
            <Button asChild variant="outline">
              <Link to="/treasury">
                View treasury
                <ArrowRightIcon data-icon="inline-end" aria-hidden />
              </Link>
            </Button>
          }
        />
        <div className="grid gap-4 md:grid-cols-2">
          <StackCard
            label="Treasury"
            tag="On chain"
            logo={
              <>
                <img src={trezuSymbol} alt="" aria-hidden="true" className="size-7 shrink-0" />
                <img src={trezuLogo} alt="Trezu" className="h-6 w-auto dark:invert" />
              </>
            }
            body="Manage your team's capital from a single dashboard without giving up your keys."
            url="https://trezu.app/"
            host="trezu.app"
          />
          <StackCard
            label="Bounties"
            tag="Live listings"
            logo={
              <img
                src={`${assetsUrl}/static/svg/nearn.svg`}
                alt="NEARN"
                className="h-7 w-auto dark:invert"
              />
            }
            body="NEARN connects sponsors with skilled contributors for bounties, projects and tasks in the NEAR ecosystem."
            url="https://nearn.io/"
            host="nearn.io"
          />
        </div>
      </section>

      <ProjectsSection />

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>For contributors</h2>
            </CardTitle>
            <CardDescription>
              Work assigned to you shows up in My work, and you get paid through DAO proposals.
            </CardDescription>
          </CardHeader>
          <CardFooter className="mt-auto flex-wrap gap-2">
            <Button asChild>
              <Link to="/apply">
                Apply to contribute
                <ArrowRightIcon data-icon="inline-end" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/dashboard">My work</Link>
            </Button>
          </CardFooter>
        </Card>

        <Card variant="highlight">
          <CardHeader>
            <CardTitle>
              <h2>Launch your own Agency</h2>
            </CardTitle>
            <CardDescription>
              Run your own Organization on the same open-source template.
            </CardDescription>
            <CardAction>
              <Badge variant="secondary">Coming soon</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {TEMPLATE.map((item) => (
                <li key={item.label} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-muted-foreground">{item.note}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter className="mt-auto">
            <Button asChild variant="outline">
              <Link to="/register">
                Register interest
                <ArrowRightIcon data-icon="inline-end" aria-hidden />
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </section>

      <footer className="flex flex-col gap-6">
        <Separator />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">{LANDING.name}</span>
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link to="/docs">Docs</Link>
            </Button>
            <Button asChild variant="ghost" size="icon-sm">
              <a href={repositoryUrl} target="_blank" rel="noopener noreferrer" aria-label="GitHub">
                <GithubLogoIcon aria-hidden />
              </a>
            </Button>
            <Button asChild variant="ghost" size="icon-sm">
              <a
                href="https://x.com/_multiagency"
                target="_blank"
                rel="me noopener noreferrer"
                aria-label="X"
              >
                <XLogoIcon aria-hidden />
              </a>
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative flex min-h-96 flex-col justify-center overflow-hidden border bg-background px-6 py-16 sm:px-10">
      <ReactionDiffusionField />
      <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-background via-background/80 to-background/10" />
      <div className="relative flex max-w-2xl flex-col items-start gap-6">
        <Badge variant="outline">Open books · Open source · Open doors</Badge>
        <div className="flex flex-col gap-3">
          <h1 className="font-heading text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {LANDING.name}
          </h1>
          <p className="max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">
            {LANDING.description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="lg">
            <Link to="/sign-in">
              Get started
              <ArrowRightIcon data-icon="inline-end" aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/work">Explore work</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  title,
  description,
  features,
}: {
  title: string;
  description: string;
  features: Feature[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h3>{title}</h3>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-4">
          {features.map(({ icon: FeatureIcon, title: featureTitle, body }) => (
            <li key={featureTitle} className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center bg-muted">
                <FeatureIcon aria-hidden className="size-4 text-muted-foreground" />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs font-medium">{featureTitle}</span>
                <span className="text-xs/relaxed text-muted-foreground">{body}</span>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ProjectsSection() {
  const apiClient = useApiClient();
  const projectsQuery = useQuery(projectsListQueryOptions(apiClient));
  const projects = (projectsQuery.data?.data ?? []) as LandingProject[];
  const visibleProjects = projects.slice(0, 6);

  return (
    <section className="flex flex-col gap-6">
      <SectionHeader
        title="Our work"
        description="Live Projects, with open listings on NEARN."
        actions={
          projects.length > 0 && (
            <Button asChild variant="outline">
              <Link to="/work">
                Explore work
                <ArrowRightIcon data-icon="inline-end" aria-hidden />
              </Link>
            </Button>
          )
        }
      />
      {projectsQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <ProjectCardSkeleton key={i} />
          ))}
        </div>
      ) : projectsQuery.isError ? (
        <LoadError title="Could not load Projects" onRetry={() => projectsQuery.refetch()} />
      ) : projects.length === 0 ? (
        <Empty variant="outline">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderSimpleIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No public Projects yet</EmptyTitle>
            <EmptyDescription>Check back soon, or apply to contribute.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleProjects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </section>
  );
}

function ProjectCard({ project }: { project: LandingProject }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>
          <span className="block truncate">@{project.slug}</span>
        </CardDescription>
        <CardTitle>
          <h3 className="break-words">{project.title}</h3>
        </CardTitle>
        {project.nearnListing ? (
          <CardAction>
            <Badge variant="secondary">Bounty</Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardFooter className="mt-auto">
        <Button asChild variant="outline" className="w-full">
          <Link to="/work">
            Open
            <ArrowRightIcon data-icon="inline-end" aria-hidden />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function ProjectCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-4 w-3/4" />
      </CardHeader>
      <CardFooter>
        <Skeleton className="h-8 w-full" />
      </CardFooter>
    </Card>
  );
}

function StackCard({
  label,
  tag,
  logo,
  body,
  url,
  host,
}: {
  label: string;
  tag: string;
  logo: ReactNode;
  body: string;
  url: string;
  host: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle>
          <h3 className="flex h-8 items-center gap-2">{logo}</h3>
        </CardTitle>
        <CardAction>
          <Badge variant="outline">{tag}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-xs/relaxed text-muted-foreground">{body}</p>
      </CardContent>
      <CardFooter className="mt-auto">
        <Button asChild variant="outline" className="w-full">
          <a href={url} target="_blank" rel="noopener noreferrer">
            {host}
            <ArrowUpRightIcon data-icon="inline-end" aria-hidden />
          </a>
        </Button>
      </CardFooter>
    </Card>
  );
}
