import type { ReactNode } from "react";
import BlurText from "@/components/react-bits/text/BlurText";
import ShinyText from "@/components/react-bits/text/ShinyText";
import type { WorkDemoProject } from "@/lib/work-demo-projects";

const editions = {
  "legion-creator-program": {
    title: "Legion Creators",
    field: "Creator program",
    format: "theatre",
  },
  "nearbuilders-growth": {
    title: "NearBuilders Growth",
    field: "Builder outreach",
    format: "grid",
  },
  nearbuildersorg: { title: "NEAR Builders", field: "Community platform", format: "wave" },
  nbsmm: { title: "Builders on Social", field: "Social media", format: "broadcast" },
} as const;
export function isCommunity(slug: string): slug is keyof typeof editions {
  return Object.hasOwn(editions, slug);
}
export function CommunitySpread({
  project,
  slug,
  motion,
  links,
}: {
  project: WorkDemoProject;
  slug: keyof typeof editions;
  motion: boolean;
  links: ReactNode;
}) {
  const { title, field, format } = editions[slug];
  return (
    <div className="wk-community" data-edition={format}>
      <div className="wk-edition-head">
        <p className="wk-edition-label">
          Community <span>/</span> {field}
        </p>
        <h3 id={`title-${slug}`}>
          {!motion || format === "broadcast" ? (
            title
          ) : format === "theatre" ? (
            <ShinyText
              text={title}
              color="#f5f3e9"
              shineColor="#f9da71"
              trigger="view"
              speed={1.1}
            />
          ) : (
            <BlurText
              text={title}
              animateBy="words"
              direction={format === "grid" ? "left" : "bottom"}
              effect="drift"
              delay={70}
              blur={1}
              distance={14}
              stepDuration={0.25}
            />
          )}
        </h3>
      </div>
      <a
        className="wk-edition-plate"
        href={project.preview.url}
        target="_blank"
        rel="noreferrer"
        aria-label={project.preview.label}
      >
        <div className="wk-edition-print">
          <img
            src={project.preview.image}
            loading="lazy"
            decoding="async"
            width={1280}
            height={800}
            alt={project.preview.label}
          />
        </div>
      </a>
      <div className="wk-edition-notes">
        <p>{project.description}</p>
        {links}
      </div>
    </div>
  );
}
