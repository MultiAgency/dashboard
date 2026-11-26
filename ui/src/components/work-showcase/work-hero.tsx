import { ArrowDownRightIcon } from "@phosphor-icons/react";
import GhostFibers from "@/components/react-bits/ghost-fibers";

export function WorkHero({ motion }: { motion: boolean }) {
  return (
    <section className="wk-hero" id="work-top" aria-labelledby="wk-title">
      <div className="wk-hero-fibers" aria-hidden="true">
        <GhostFibers
          key={motion ? "moving" : "still"}
          glowColor="#ffc329"
          lineColor="#ffdf7d"
          secondaryColor="#916425"
          fiberStyle="dots"
          rotation={-16}
          threads={70}
          depthOfField={0.9}
          speed={0.55}
          intro={false}
          paused={!motion}
          mouseInteraction={motion}
          pulseOnClick={false}
          dpr={1}
        />
      </div>
      <div className="wk-hero-copy">
        <h1 id="wk-title">Work by Multiagency</h1>
        <p>Explore the payment systems, developer tools, and communities we build on NEAR.</p>
        <nav aria-label="Explore our work">
          <a href="#featured">
            Selected work <ArrowDownRightIcon aria-hidden="true" />
          </a>
          <a href="#projects">Project index</a>
        </nav>
      </div>
    </section>
  );
}
