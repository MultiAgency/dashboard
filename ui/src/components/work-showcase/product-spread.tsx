import { ArrowUpRightIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { WorkDemoProject } from "@/lib/work-demo-projects";

const spreads = {
  "payments-plugin": {
    name: "pay.everything.dev",
    lead: "pay.",
    rest: "everything.dev",
    category: "Payments",
    headline: "One contract for every checkout.",
    description:
      "Connect Stripe and PingPay through a shared interface for checkout, webhooks, and payment status.",
    caption: "Payment provider demo",
    action: "Explore the demo",
  },
  "city-nodes": {
    name: "City Nodes",
    lead: "City",
    rest: "Nodes",
    category: "Validator communities",
    headline: "Stake with your city.",
    description:
      "Find your local NEAR chapter, meet other builders, and stake NEAR to support the validator in your city.",
    caption: "Local chapter directory",
    action: "Find a chapter",
  },
  "agent-connect": {
    name: "Agent Connect",
    lead: "Agent",
    rest: "Connect",
    category: "Developer tools",
    headline: "A wallet with rules the owner signs.",
    description:
      "Give an AI agent its own NEAR Intents wallet. The owner signs spending rules that limit what the agent can do.",
    caption: "Agent API documentation",
    action: "Read the API docs",
  },
} as const;

export function hasProductSpread(slug: string): slug is keyof typeof spreads {
  return Object.hasOwn(spreads, slug);
}

export function ProductSpread({
  project,
  slug,
  renderLinks,
}: {
  project: WorkDemoProject;
  slug: keyof typeof spreads;
  renderLinks: (action: string) => ReactNode;
}) {
  const spread = spreads[slug];
  return (
    <div className="wk-product-spread">
      <div className="wk-product-intro">
        <p className="wk-product-category">{spread.category}</p>
        <h3 id={`title-${slug}`} aria-label={spread.name}>
          <span>{spread.lead}</span> <span>{spread.rest}</span>
        </h3>
      </div>
      <div className="wk-product-notes">
        <p className="wk-product-hook">{spread.headline}</p>
        <p className="wk-description">{spread.description}</p>
        {renderLinks(spread.action)}
      </div>
      <a
        className="wk-product-preview"
        href={project.preview.url}
        target="_blank"
        rel="noreferrer"
        aria-label={spread.action}
      >
        <div className="wk-product-image">
          <img
            loading="lazy"
            decoding="async"
            width="1280"
            height="800"
            src={project.preview.image}
            alt={project.preview.label}
          />
        </div>
        <span>
          {spread.caption} <ArrowUpRightIcon aria-hidden="true" />
        </span>
      </a>
    </div>
  );
}
