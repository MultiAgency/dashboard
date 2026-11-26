import { lazy, Suspense } from "react";
import BlurText from "@/components/react-bits/text/BlurText";
import DecryptedText from "@/components/react-bits/text/DecryptedText";
import GlitchText from "@/components/react-bits/text/GlitchText";
import ShinyText from "@/components/react-bits/text/ShinyText";

const Beams = lazy(() => import("@/components/react-bits/backgrounds/Beams"));
const Dither = lazy(() => import("@/components/react-bits/backgrounds/Dither"));
const DotGrid = lazy(() => import("@/components/react-bits/backgrounds/DotGrid"));
const LetterGlitch = lazy(() => import("@/components/react-bits/backgrounds/LetterGlitch"));
const LightRays = lazy(() => import("@/components/react-bits/backgrounds/LightRays"));
const RippleGrid = lazy(() => import("@/components/react-bits/backgrounds/RippleGrid"));
const ShapeGrid = lazy(() => import("@/components/react-bits/backgrounds/ShapeGrid"));
const Silk = lazy(() => import("@/components/react-bits/backgrounds/Silk"));
const Waves = lazy(() => import("@/components/react-bits/backgrounds/Waves"));

const Topography = lazy(() => import("@/components/react-bits/backgrounds/Topography"));
const FluxLines = lazy(() => import("@/components/react-bits/backgrounds/FluxLines"));
const Scanner = lazy(() => import("@/components/react-bits/backgrounds/Scanner"));
const Radar = lazy(() => import("@/components/react-bits/backgrounds/Radar"));
const gold = "#ffd426";
const inks = ["#b28b18", gold, "#fff2ac"];
const plate = { intro: false, dpr: 0.8 };
const featuredArt = {
  pingpay: (
    <FluxLines
      {...plate}
      colors={inks}
      flowDirection="right"
      speed={0.48}
      mouseInteraction={false}
    />
  ),
  "city-nodes": (
    <Topography
      {...plate}
      color={gold}
      majorLines
      markers="dots"
      glow={0.5}
      mouseInteraction={false}
    />
  ),
  "agent-connect": (
    <Scanner
      {...plate}
      color1="#897318"
      color2={gold}
      color3="#fff3be"
      scanDirection="horizontal"
      mouseInteraction={false}
    />
  ),
};

export function FeaturedArt({ slug }: { slug: string }) {
  return <Suspense fallback={null}>{featuredArt[slug as keyof typeof featuredArt]}</Suspense>;
}
const projectArt = {
  nbsmm: (
    <Radar
      {...plate}
      color="#ffda46"
      backgroundColor="#000000"
      speed={0.57}
      ringCount={4}
      spokeCount={3}
      ticks={false}
      clutter={0}
      targets={4}
      gridOpacity={0.24}
      grain={0}
      centerX={0.34}
      centerY={0.52}
      scale={0.88}
      tilt={12}
      mouseInteraction={false}
    />
  ),
  "agent-connect": (
    <Scanner
      {...plate}
      color1="#4d6974"
      color2="#a9c3c9"
      color3="#ffe994"
      scanDirection="vertical"
      speed={0.3}
      grain={false}
      scanline={false}
      mouseInteraction={false}
    />
  ),
  "city-nodes": (
    <Topography
      {...plate}
      color="#dfc56f"
      direction="forward"
      majorLines
      markers="none"
      speed={0.25}
      glow={0.22}
      mouseInteraction={false}
    />
  ),
  "hackathon-bot": (
    <LetterGlitch
      {...plate}
      baseColor="#977d30"
      glitchColors={inks}
      characters="01{}#<>/:"
      interactive={false}
    />
  ),
  "legion-creator-program": (
    <LightRays
      raysOrigin="top-left"
      raysColor={gold}
      maxDevicePixelRatio={0.8}
      intro={false}
      followMouse={false}
    />
  ),
  nearbuildersbot: (
    <Dither {...plate} waveColor={gold} pixelSize={4} enableMouseInteraction={false} />
  ),
  "near-edu-content": (
    <ShapeGrid {...plate} shape="tile" direction="up" cellSize={48} lineColor="#d9af38" />
  ),
  "nearbuilders-growth": (
    <DotGrid {...plate} baseColor="#b79838" activeColor={gold} dotSize={4} gap={20} intro />
  ),
  nearbuildersorg: (
    <Waves {...plate} lineColor={gold} accentColor="#fff2ac" mouseInteraction={false} />
  ),
  nostr: <RippleGrid {...plate} color={gold} autoRipple="center" mouseInteraction={false} />,
  pingonramp: <Beams {...plate} color={gold} rotation={34} mouseInteraction={false} />,
  "payments-plugin": (
    <FluxLines
      {...plate}
      colors={["#554412", "#ae842c", "#ffcf53"]}
      flowDirection="right"
      speed={0.3}
      mouseInteraction={false}
    />
  ),
  pingpay: <Silk {...plate} color="#d8a51c" sheenColor="#fff2ac" mouseInteraction={false} />,
};

export function ProjectArt({ slug }: { slug: string }) {
  return <Suspense fallback={null}>{projectArt[slug as keyof typeof projectArt]}</Suspense>;
}

export function ProjectTitle({ slug, title }: { slug: string; title: string }) {
  switch (slug) {
    case "hackathon-bot":
      return (
        <GlitchText
          fontSize="inherit"
          fontWeight="inherit"
          intensity={0.45}
          shadowColors={["#b28b18", gold]}
          flicker={false}
        >
          {title}
        </GlitchText>
      );
    case "nearbuildersbot":
    case "nostr":
      return (
        <DecryptedText
          text={title}
          animateOn="view"
          sequential
          speed={24}
          scrambleColor={gold}
          effect={slug === "nearbuildersbot" ? "flip" : "scramble"}
        />
      );
    case "pingpay":
      return (
        <ShinyText text={title} trigger="view" color="#f5f3e9" shineColor={gold} speed={1.3} />
      );
    default:
      return (
        <BlurText
          text={title}
          animateBy="words"
          effect="drift"
          direction="bottom"
          blur={5}
          distance={25}
          delay={65}
          stepDuration={0.23}
        />
      );
  }
}
