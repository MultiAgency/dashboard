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

const DOT_CELL = 14;
const DOT_LEVELS = 6;
const FIELD_SPEED = 0.00018;
const RIDGE_AT = 0.9;
const RIDGE_WIDTH = 0.035;

function hash(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function smoothNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function flowField(x: number, y: number, t: number): number {
  const warpX = smoothNoise(x * 0.6 + t * 0.7, y * 0.6 - t * 0.4);
  const warpY = smoothNoise(x * 0.6 - t * 0.5 + 5.2, y * 0.6 + t * 0.6 + 1.3);
  const base = smoothNoise(x + warpX * 1.6 + t, y + warpY * 1.6 - t * 0.6);
  const detail = smoothNoise(x * 2.1 - t * 1.3, y * 2.1 + t * 0.9);
  return base * 0.75 + detail * 0.25;
}

function DotField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

    let dpr = 1;
    let cols = 0;
    let rows = 0;
    let cell = DOT_CELL;
    let mask = new Float32Array(0);
    const pointer = { x: -1, y: -1, strength: 0, target: 0 };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      cell = DOT_CELL * dpr;
      cols = Math.ceil(canvas.width / cell);
      rows = Math.ceil(canvas.height / cell);
      mask = new Float32Array(cols * rows);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const nx = c / Math.max(1, cols - 1);
          const ny = r / Math.max(1, rows - 1);
          const textFade = Math.min(1, Math.max(0, (nx - 0.18) / 0.5));
          const edgeX = Math.min(nx, 1 - nx) / 0.05;
          const edgeY = Math.min(ny, 1 - ny) / 0.1;
          const edge = Math.min(1, edgeX, edgeY);
          mask[r * cols + c] = textFade * edge * edge * (3 - 2 * edge);
        }
      }
      if (!running) render(performance.now());
    };

    const buckets: number[][] = Array.from({ length: DOT_LEVELS }, () => []);
    const ridges: number[] = [];
    const render = (now: number) => {
      const t = reducedMotion ? 12 : now * FIELD_SPEED;
      pointer.strength += (pointer.target - pointer.strength) * 0.08;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const bucket of buckets) bucket.length = 0;
      ridges.length = 0;
      const radius = 9;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const m = mask[r * cols + c]!;
          if (m <= 0.01) continue;
          let value = flowField(c * 0.085, r * 0.11, t);
          value = Math.min(1.2, Math.max(0, (value - 0.34) / 0.42));
          if (pointer.strength > 0.01) {
            const dx = c - pointer.x;
            const dy = r - pointer.y;
            const falloff = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / radius);
            value += falloff * falloff * 0.55 * pointer.strength;
          }
          const vm = value * m;
          if (Math.abs(vm - RIDGE_AT) < RIDGE_WIDTH) {
            ridges.push(c, r);
            continue;
          }
          const level = Math.floor(Math.min(0.999, vm * 0.84) * DOT_LEVELS);
          if (level > 0) buckets[level]!.push(c, r);
        }
      }
      ctx.fillStyle = dotColor;
      for (let level = 1; level < DOT_LEVELS; level++) {
        const bucket = buckets[level]!;
        if (bucket.length === 0) continue;
        const size = Math.max(dpr, cell * (0.14 + 0.46 * (level / (DOT_LEVELS - 1))));
        const offset = (cell - size) / 2;
        ctx.globalAlpha = 0.1 + 0.12 * level;
        for (let i = 0; i < bucket.length; i += 2) {
          ctx.fillRect(bucket[i]! * cell + offset, bucket[i + 1]! * cell + offset, size, size);
        }
      }
      if (ridges.length > 0) {
        const size = cell * 0.5;
        const offset = (cell - size) / 2;
        ctx.fillStyle = peakColor;
        ctx.globalAlpha = 0.95;
        for (let i = 0; i < ridges.length; i += 2) {
          ctx.fillRect(ridges[i]! * cell + offset, ridges[i + 1]! * cell + offset, size, size);
        }
      }
      ctx.globalAlpha = 1;
    };

    const themeObserver = new MutationObserver(() => {
      dotColor = readToken("--muted-foreground");
      peakColor = readToken("--primary");
      if (!running) render(performance.now());
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });

    const host = canvas.parentElement ?? canvas;
    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) * dpr) / cell;
      pointer.y = ((event.clientY - rect.top) * dpr) / cell;
      pointer.target = 1;
    };
    const onPointerLeave = () => {
      pointer.target = 0;
    };

    let running = false;
    let visible = true;
    let rafId = 0;
    const tick = (now: number) => {
      render(now);
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

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      sync();
    });
    intersectionObserver.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    if (!reducedMotion) {
      host.addEventListener("pointermove", onPointerMove);
      host.addEventListener("pointerleave", onPointerLeave);
    }
    sync();

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      themeObserver.disconnect();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", sync);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

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
      <DotField />
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
