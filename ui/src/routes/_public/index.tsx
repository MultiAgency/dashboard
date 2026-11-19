import type { Icon } from "@phosphor-icons/react";
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  BuildingsIcon,
  CalendarCheckIcon,
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
import { createFileRoute, Link } from "@tanstack/react-router";
import { type MotionStyle, motion, useScroll, useTransform } from "framer-motion";
import { type ReactNode, useRef, useSyncExternalStore } from "react";
import trezuLogo from "@/assets/brand/trezu.svg";
import trezuSymbol from "@/assets/brand/trezu-symbol.svg";
import { DiffusionField } from "@/components/landing/diffusion-field";
import ScrollStack, { ScrollStackItem } from "@/components/react-bits/scroll-stack";
import BlurText from "@/components/react-bits/text/BlurText";
import DecryptedText from "@/components/react-bits/text/DecryptedText";
import { getRepoUrl } from "@/lib/repo";
import { workDemoProjects } from "@/lib/work-demo-projects";
import { Route as RootRoute } from "../__root";
import "@/components/landing/landing.css";

const description =
  "MultiAgency builds open-source software on NEAR. Clients and builders share the plan, track the work, and follow every payout on chain.";

export const Route = createFileRoute("/_public/")({
  head: () => ({
    meta: [
      { title: "MultiAgency — Open books for agency work" },
      { name: "description", content: description },
    ],
  }),
  component: Landing,
});

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
    title: "Budgets and reports per Client",
    body: "Allocate budget to each Project and share period reports with the Client.",
  },
  {
    icon: TreeStructureIcon,
    title: "Subcontract in one step",
    body: "Hand a Project to another Agency. They pay their contributors from their own DAO.",
  },
];

const audiences = [
  { name: "For clients", heading: "Steer the work.", features: FOR_CLIENTS },
  { name: "For agencies", heading: "Run the engagement.", features: FOR_AGENCIES },
];

const selected = [
  {
    slug: "pingpay",
    kind: "Payments",
    name: "PingPay",
    note: "One checkout link for payments across chains.",
  },
  {
    slug: "agent-connect",
    kind: "Developer tools",
    name: "Agent Connect",
    note: "Wallets for AI agents, with spending rules set by their owners.",
  },
  {
    slug: "city-nodes",
    kind: "Community",
    name: "City Nodes",
    note: "A way to find local NEAR chapters and stake with a city’s validators.",
  },
];

const motionQuery = "(prefers-reduced-motion: no-preference)";
function subscribeMotion(update: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", update);
  return () => query.removeEventListener("change", update);
}
function usePageMotion() {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(motionQuery).matches,
    () => false,
  );
}
// Measure the stationary wrapper; only its children move as it enters the viewport.
function ScrollScene({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const animate = usePageMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 98%", "start 23%"] });
  const style = { "--ma-entry": scrollYProgress } as MotionStyle;
  return (
    <motion.div ref={ref} className={className} style={animate ? style : undefined}>
      {children}
    </motion.div>
  );
}
function ScrollTitle({ text, decrypt = false }: { text: string; decrypt?: boolean }) {
  const animate = usePageMotion();
  if (!animate) return text;
  if (decrypt)
    return (
      <DecryptedText
        text={text}
        animateOn="view"
        sequential
        speed={28}
        maxIterations={5}
        scrambleColor="var(--gold)"
      />
    );
  return (
    <BlurText
      text={text}
      className="ma-reveal"
      direction="bottom"
      trigger="view"
      delay={50}
      stepDuration={0.22}
      threshold={0.18}
      animationFrom={{ opacity: 0.78, y: 16, filter: "blur(1.5px)" }}
      animationTo={[{ opacity: 1, y: 0, filter: "blur(0px)" }]}
    />
  );
}

function ProjectSpread({
  slug,
  kind,
  name,
  note,
  image,
}: (typeof selected)[number] & { image: string }) {
  const spread = useRef<HTMLDivElement>(null);
  const animate = usePageMotion();
  const { scrollYProgress } = useScroll({ target: spread, offset: ["start end", "start 12%"] });
  const scale = useTransform(scrollYProgress, [0, 1], [1.48, 1.02]);
  const y = useTransform(scrollYProgress, [0, 1], ["9%", "0%"]);
  return (
    <div ref={spread} className="ma-spread">
      <Link to="/work/$slug" params={{ slug }} className="ma-project">
        <div className="ma-project-info">
          <p className="ma-label">{kind}</p>
          <h3>{name}</h3>
          <p>{note}</p>
          <span className="ma-project-action">
            View project <ArrowUpRightIcon aria-hidden />
          </span>
        </div>
        <div className="ma-preview">
          <motion.img
            src={image}
            alt=""
            width="1280"
            height="800"
            loading="lazy"
            style={animate ? { scale, y } : undefined}
          />
        </div>
      </Link>
    </div>
  );
}

function SelectedWork() {
  return (
    <section id="selected-work" className="ma-work ma-section" aria-labelledby="ma-work-title">
      <div className="ma-section-head">
        <div>
          <h2 id="ma-work-title">
            <ScrollTitle text="Portfolio" decrypt />
            <span className="ma-stop">.</span>
          </h2>
        </div>
        <Link className="ma-text-link" to="/work">
          Explore the Work page <ArrowRightIcon />
        </Link>
      </div>
      <ScrollStack
        className="ma-portfolio-stack"
        useWindowScroll
        smoothScroll={false}
        snap={false}
        stackPosition={74}
        itemStackDistance={14}
        itemDistance={64}
        itemScale={0.1}
        baseScale={0.8}
        dimAmount={0.24}
        holdDistance={32}
      >
        {selected.map(({ slug, kind, name, note }) => {
          const project = workDemoProjects.find((item) => item.slug === slug);
          if (!project) return null;
          return (
            <ScrollStackItem key={slug} itemClassName={`ma-poster ma-poster-${slug}`}>
              <ProjectSpread
                slug={slug}
                kind={kind}
                name={name}
                note={note}
                image={project.preview.image}
              />
            </ScrollStackItem>
          );
        })}
      </ScrollStack>
      <h3 className="ma-archive-title">More projects</h3>
      <ul className="ma-project-index" aria-label="More projects">
        {workDemoProjects
          .filter((project) => !selected.some((item) => item.slug === project.slug))
          .map((project) => (
            <li key={project.slug}>
              <Link to="/work/$slug" params={{ slug: project.slug }}>
                {project.title}
                <ArrowUpRightIcon aria-hidden />
              </Link>
            </li>
          ))}
      </ul>
    </section>
  );
}

function Workspace() {
  return (
    <section
      id="workspace"
      className="ma-section ma-workspace"
      aria-labelledby="ma-workspace-title"
    >
      <div className="ma-section-head">
        <div>
          <p className="ma-label">The workspace</p>
          <h2 id="ma-workspace-title">
            <ScrollTitle text="Both sides of the work." />
          </h2>
        </div>
        <Link to="/sign-in" className="ma-text-link">
          Enter the workspace <ArrowRightIcon />
        </Link>
      </div>
      <div className="ma-audiences">
        {audiences.map(({ name, heading, features }) => (
          <ScrollScene className="ma-leaf" key={name}>
            <article className="ma-perspective">
              <p className="ma-label">{name}</p>
              <h3>{heading}</h3>
              <dl>
                {features.map(({ icon: FeatureIcon, title, body }) => (
                  <div key={title}>
                    <dt>
                      <FeatureIcon aria-hidden />
                      {title}
                    </dt>
                    <dd>{body}</dd>
                  </div>
                ))}
              </dl>
            </article>
          </ScrollScene>
        ))}
      </div>
    </section>
  );
}

function LandingHero() {
  const track = useRef<HTMLElement>(null);
  const animate = usePageMotion();
  const { scrollYProgress } = useScroll({ target: track, offset: ["start start", "end start"] });
  const scale = useTransform(scrollYProgress, [0, 0.57], [1, 1.42]);
  const y = useTransform(scrollYProgress, [0, 0.57], ["0%", "-20%"]);
  return (
    <section ref={track} className="ma-hero" aria-labelledby="ma-title">
      <div className="ma-hero-stage">
        <div className="ma-hero-body">
          <div className="ma-hero-copy">
            <p className="ma-label ma-signal">Open-source software agency · NEAR ecosystem</p>
            <motion.h1 id="ma-title" style={animate ? { scale, y, originX: 0 } : undefined}>
              MultiAgency
            </motion.h1>
            <h2 className="ma-hero-line">Open books for agency work.</h2>
            <p className="ma-intro">
              We build software on NEAR. From the first brief to the final payout, our clients can
              see what’s being built and where their money goes.
            </p>
            <div className="ma-actions">
              <Link className="ma-button" to="/contact">
                Hire us <ArrowUpRightIcon />
              </Link>
              <a className="ma-text-link" href="#selected-work">
                Explore our work <ArrowDownIcon />
              </a>
            </div>
          </div>
        </div>
        <nav aria-label="On this page" className="ma-contents">
          <a href="#workspace">
            The workspace <ArrowDownIcon />
          </a>
          <a href="#open-books">
            Open books <ArrowDownIcon />
          </a>
          <a href="#selected-work">
            Portfolio <ArrowDownIcon />
          </a>
        </nav>
      </div>
    </section>
  );
}

function Landing() {
  const assetsUrl = RootRoute.useLoaderData()?.runtimeConfig?.assetsUrl ?? "";
  return (
    <div className="ma-landing">
      <DiffusionField />
      <LandingHero />
      <Workspace />
      <section id="open-books" className="ma-section ma-books" aria-labelledby="ma-books-title">
        <div className="ma-ledger">
          <div>
            <p className="ma-label">How we work</p>
            <h2 id="ma-books-title">
              <ScrollTitle text="Open books" decrypt />
              <span className="ma-stop">.</span>
            </h2>
            <ScrollScene className="ma-payment-sequence">
              <ol className="ma-flow">
                <li>
                  <strong>Engagement</strong>
                  <span>Invite a client into a shared workspace.</span>
                </li>
                <li>
                  <strong>Allocation</strong>
                  <span>Agree a budget for each project.</span>
                </li>
                <li>
                  <strong>Payout</strong>
                  <span>Verify each billing through its DAO transfer proposal.</span>
                </li>
              </ol>
            </ScrollScene>
            <Link className="ma-text-link" to="/treasury">
              View the treasury <ArrowRightIcon />
            </Link>
          </div>
          <div className="ma-partners">
            <a href="https://trezu.app/" target="_blank" rel="noreferrer">
              <div>
                <p className="ma-label">Treasury</p>
                <h3 className="ma-logo">
                  <img src={trezuSymbol} alt="" />
                  <img src={trezuLogo} alt="Trezu" />
                </h3>
                <p>Manage payouts and permissions while keeping custody of your funds.</p>
              </div>
              <ArrowUpRightIcon />
            </a>
            <a href="https://nearn.io/" target="_blank" rel="noreferrer">
              <div>
                <p className="ma-label">Bounties</p>
                <h3 className="ma-logo">
                  <img src={`${assetsUrl}/static/svg/nearn.svg`} alt="NEARN" />
                </h3>
                <p>Find open bounties, projects, and paid tasks across the NEAR ecosystem.</p>
              </div>
              <ArrowUpRightIcon />
            </a>
          </div>
        </div>
      </section>
      <section className="ma-invite" aria-labelledby="ma-invite-title">
        <ScrollScene className="ma-invite-copy">
          <p className="ma-label">Work with us</p>
          <h2 id="ma-invite-title">
            <span className="ma-brief-phrase">Bring us</span>{" "}
            <span className="ma-brief-phrase">your brief.</span>
          </h2>
          <Link className="ma-button" to="/contact">
            Tell us about your project <ArrowUpRightIcon />
          </Link>
        </ScrollScene>
        <div className="ma-join">
          <div>
            <h3>Join as a contributor</h3>
            <p>Take on project work and get paid through the agency DAO.</p>
            <Link to="/apply">
              Apply to contribute <ArrowUpRightIcon />
            </Link>
            <Link to="/dashboard">
              My work <ArrowRightIcon />
            </Link>
          </div>
          <div>
            <h3>Launch your own agency</h3>
            <p>Register your interest in the open-source agency template.</p>
            <Link to="/register">
              Register interest <ArrowUpRightIcon />
            </Link>
          </div>
        </div>
      </section>
      <SelectedWork />
      <footer className="ma-footer">
        <span>MultiAgency</span>
        <nav aria-label="Resources">
          <Link to="/docs">Docs</Link>
          <a href={getRepoUrl()} target="_blank" rel="noreferrer">
            <GithubLogoIcon /> GitHub
          </a>
          <a href="https://x.com/_multiagency" target="_blank" rel="me noreferrer">
            <XLogoIcon /> <span className="sr-only">X</span>
          </a>
        </nav>
      </footer>
    </div>
  );
}
