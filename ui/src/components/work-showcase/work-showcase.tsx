import "./work-showcase.css";
import { ArrowDownIcon, ArrowUpIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import PillNav from "@/components/react-bits/pill-nav";
import ScrollStack, { ScrollStackItem } from "@/components/react-bits/scroll-stack";
import { type WorkDemoProject, workDemoProjects } from "@/lib/work-demo-projects";
import { CommunitySpread, isCommunity } from "./community-spread";
import { hasProductSpread, ProductSpread } from "./product-spread";
import { FeaturedArt, ProjectArt, ProjectTitle } from "./project-motion";
import { WorkHero } from "./work-hero";

const groups = {
  Payments: ["pingpay", "payments-plugin", "pingonramp"],
  "Developer tools": [
    "agent-connect",
    "hackathon-bot",
    "near-edu-content",
    "nostr",
    "nearbuildersbot",
  ],
  Community: [
    "nearbuilders-growth",
    "nearbuildersorg",
    "city-nodes",
    "nbsmm",
    "legion-creator-program",
  ],
};
const chapters = [
  {
    slug: "pingpay",
    name: "PingPay",
    category: "Cross-chain payments",
    headline: "One link. Any chain.",
    detail:
      "A hosted checkout lets someone send crypto across chains and settle in the asset the recipient chooses.",
    action: "Visit PingPay",
  },
  {
    slug: "city-nodes",
    name: "City Nodes",
    category: "Validator communities",
    headline: "A network with a hometown.",
    detail:
      "Local chapters bring validators and builders together. Find events near you and stake NEAR to support your city’s node.",
    action: "Find a chapter",
  },
  {
    slug: "agent-connect",
    name: "Agent Connect",
    category: "Developer infrastructure",
    headline: "A wallet for your agent.",
    detail:
      "Give an AI agent its own NEAR Intents wallet. The owner defines the rules that govern what the agent can do.",
    action: "Read the API docs",
  },
];
const chapterLinks = chapters.map((chapter) => ({
  label: chapter.name,
  href: `#story-${chapter.slug}`,
}));
const motionQuery = "(prefers-reduced-motion: no-preference)";
function subscribeMotion(update: () => void) {
  const media = matchMedia(motionQuery);
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}

function ProjectLinks({ project, action }: { project: WorkDemoProject; action?: string }) {
  return (
    <div className="wk-links">
      <a href={project.preview.url} target="_blank" rel="noreferrer">
        {action ?? project.preview.label} <ArrowUpRightIcon />
      </a>
      {project.repository && project.repository !== project.preview.url && (
        <a href={project.repository} target="_blank" rel="noreferrer">
          {project.repository.includes("github.com/") ? "GitHub" : "Project brief"}{" "}
          <ArrowUpRightIcon />
        </a>
      )}
      <Link to="/work/$slug" params={{ slug: project.slug }}>
        Project details
      </Link>
    </div>
  );
}

const archiveProjects = [...workDemoProjects].sort((a, b) => a.title.localeCompare(b.title, "en"));
const archiveFilters = ["All", "Payments", "Developer tools", "Community"] as const;

function ProjectArchive({ motion }: { motion: boolean }) {
  const [filter, setFilter] = useState<(typeof archiveFilters)[number]>("All");
  const [active, setActive] = useState("");
  const sequence = useRef<HTMLDivElement>(null);
  const projects = archiveProjects.filter(
    (p) => filter === "All" || groups[filter].includes(p.slug),
  );
  useEffect(() => {
    const sequenceNode = sequence.current;
    if (!sequenceNode || !motion) return;
    const visible = new Set<HTMLElement>();
    let timer = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const panel = entry.target as HTMLElement;
          if (entry.isIntersecting) visible.add(panel);
          else visible.delete(panel);
        }
        // A fast fling can cross several projects before their shaders are ready.
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          const line = window.innerHeight * 0.4;
          const panel =
            Array.from(visible).find((node) => {
              const box = node.getBoundingClientRect();
              return box.top <= line && box.bottom >= line;
            }) ?? visible.values().next().value;
          setActive(panel?.dataset.slug ?? "");
        }, 90);
      },
      { rootMargin: "-36% 0px -56% 0px" },
    );
    for (const panel of sequenceNode.children) observer.observe(panel);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [motion, filter]);
  return (
    <section id="projects" className="wk-index" aria-labelledby="wk-index-title">
      <div className="wk-index-head">
        <h2 id="wk-index-title">
          Project <em>index</em>
        </h2>
        <span className="wk-count">{workDemoProjects.length} projects</span>
      </div>
      <fieldset className="wk-filters" aria-label="Filter projects">
        {archiveFilters.map((group) => (
          <button
            type="button"
            key={group}
            aria-pressed={group === filter}
            onClick={() => setFilter(group)}
          >
            {group}
            <sup>{group === "All" ? archiveProjects.length : groups[group].length}</sup>
          </button>
        ))}
      </fieldset>
      <div className="wk-archive" id="project-links" ref={sequence}>
        {projects.map((project, index) => {
          const next = projects[index + 1];
          const live = motion && active === project.slug;
          const group = archiveFilters.find((g) => g !== "All" && groups[g].includes(project.slug));
          return (
            <article
              key={project.slug}
              id={`project-${project.slug}`}
              data-slug={project.slug}
              data-live={live}
              className="wk-project"
              aria-labelledby={`title-${project.slug}`}
            >
              <div className="wk-project-art" aria-hidden="true">
                {live && <ProjectArt slug={project.slug} />}
              </div>
              {hasProductSpread(project.slug) ? (
                <ProductSpread
                  project={project}
                  slug={project.slug}
                  renderLinks={(action) => <ProjectLinks project={project} action={action} />}
                />
              ) : isCommunity(project.slug) ? (
                <CommunitySpread
                  project={project}
                  slug={project.slug}
                  motion={motion}
                  links={<ProjectLinks project={project} />}
                />
              ) : (
                <div className="wk-project-body">
                  <div className="wk-project-copy">
                    <p className="wk-meta">{group}</p>
                    <h3 id={`title-${project.slug}`} aria-label={project.title}>
                      {live ? (
                        <ProjectTitle slug={project.slug} title={project.title} />
                      ) : (
                        project.title
                      )}
                    </h3>
                    <p className="wk-description">{project.description}</p>
                    <ProjectLinks project={project} />
                  </div>
                  <a
                    className="wk-project-visual"
                    href={project.preview.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={project.preview.label}
                  >
                    <img
                      src={project.preview.image}
                      loading="lazy"
                      decoding="async"
                      width={1280}
                      height={800}
                      alt={project.preview.label}
                    />
                  </a>
                </div>
              )}
              <div className="wk-project-foot">
                <span>
                  <span className="sr-only">Project </span>
                  {String(index + 1).padStart(2, "0")} / {String(projects.length).padStart(2, "0")}
                </span>
                <div aria-hidden="true" className="wk-meter">
                  {projects.map((p, i) => (
                    <i key={p.slug} data-read={i <= index} />
                  ))}
                </div>
                <a href={next ? `#project-${next.slug}` : "#work-top"}>
                  {next ? "Next project" : "Back to top"}{" "}
                  {next ? <ArrowDownIcon /> : <ArrowUpIcon />}
                </a>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function WorkShowcase() {
  const motion = useSyncExternalStore(
    subscribeMotion,
    () => matchMedia(motionQuery).matches,
    () => false,
  );
  const root = useRef<HTMLDivElement>(null);
  const [currentChapter, setCurrentChapter] = useState("");
  useEffect(() => {
    if (!root.current) return;
    const scenes = root.current.querySelectorAll<HTMLElement>(".wk-scene");
    const markers = root.current.querySelectorAll<HTMLElement>(".wk-stack [id^=story-], #projects");
    let frame = 0;
    function update() {
      frame = 0;
      let active = "";
      for (const marker of markers) {
        if (marker.getBoundingClientRect().top <= innerHeight * 0.48) active = marker.id;
      }
      setCurrentChapter(active);
      if (!motion) return;
      for (const scene of scenes) {
        const box = scene.getBoundingClientRect();
        if (box.bottom < 0 || box.top > innerHeight) continue;
        const progress = (innerHeight / 2 - box.top - box.height / 2) / (innerHeight + box.height);
        const approach = Math.min(1, Math.max(0, (box.top - 104) / innerHeight));
        scene.style.setProperty("--preview-scale", String(1 - approach * 0.14));
        scene.style.setProperty("--drift", `${Math.round(progress * 140)}px`);
      }
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
      for (const scene of scenes) {
        scene.style.removeProperty("--drift");
        scene.style.removeProperty("--preview-scale");
      }
    };
  }, [motion]);

  return (
    <div ref={root} className="work-showcase">
      <WorkHero motion={motion} />
      <div className="wk-chapter-nav">
        <a href="#featured">
          Selected work <ArrowDownIcon />
        </a>
        <div className="wk-chapter-picker">
          <PillNav
            items={chapterLinks}
            activeHref={`#${currentChapter}`}
            ariaLabel="Selected project chapters"
            theme="light"
            layout="joined"
            surface="none"
            itemStyle="plain"
            indicator="pill"
            highlightColor="#000"
            highlightTextColor="#ffd426"
            textColor="#000"
            size="sm"
            collapse="never"
            intro={false}
          />
        </div>
        <a href="#projects" aria-current={currentChapter === "projects" ? "location" : undefined}>
          Project index <sup>{workDemoProjects.length}</sup>
        </a>
      </div>
      <section id="featured" aria-label="Selected work">
        <ScrollStack
          className="wk-stack"
          useWindowScroll
          smoothScroll={false}
          itemDistance={0}
          itemStackDistance={0}
          stackPosition={104}
          itemScale={0.043}
          baseScale={0.88}
          dimAmount={0.39}
          holdDistance={30}
        >
          {chapters.map((c) => {
            const project = workDemoProjects.find((p) => p.slug === c.slug);
            if (!project) return null;
            return (
              <ScrollStackItem anchorId={`story-${c.slug}`} key={c.slug} itemClassName="wk-sheet">
                <article className={`wk-scene wk-${c.slug}`}>
                  {motion && currentChapter === `story-${c.slug}` && (
                    <div className="wk-feature-field" aria-hidden="true">
                      <FeaturedArt slug={c.slug} />
                    </div>
                  )}
                  <div className="wk-story-copy">
                    <p className="wk-meta">{c.category}</p>
                    <h2>{c.name}</h2>
                    <h3>{c.headline}</h3>
                    <p className="wk-description">{c.detail}</p>
                    <ProjectLinks project={project} action={c.action} />
                  </div>
                  <a
                    className="wk-stage"
                    aria-label={`${c.action} (opens in a new tab)`}
                    href={project.preview.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <div className="wk-orbit" aria-hidden="true" />
                    <img
                      src={project.preview.image}
                      alt={project.preview.label}
                      loading="lazy"
                      decoding="async"
                      width={1280}
                      height={800}
                    />
                  </a>
                </article>
              </ScrollStackItem>
            );
          })}
        </ScrollStack>
      </section>
      <ProjectArchive motion={motion} />
    </div>
  );
}
