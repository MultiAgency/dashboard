import { createFileRoute } from "@tanstack/react-router";
import { CyclicCAField } from "@/components/cyclic-ca-field";
import { FlowField } from "@/components/flow-field";
import { type RdPreset, ReactionDiffusionField } from "@/components/reaction-diffusion-field";
import { WorleyField } from "@/components/worley-field";

export const Route = createFileRoute("/_layout/preview-fields")({
  head: () => ({ meta: [{ title: "Generative field preview" }] }),
  component: PreviewFields,
});

const RD_PRESETS: { key: RdPreset; label: string; spec: string }[] = [
  { key: "worms", label: "Worms", spec: "F=0.060 K=0.062 — current default" },
  { key: "solitons", label: "Solitons", spec: "F=0.0367 K=0.0649 — drifting blobs" },
  { key: "mitosis", label: "Mitosis", spec: "F=0.014 K=0.054 — dividing cells" },
  { key: "spots", label: "Spots", spec: "F=0.062 K=0.0609 — static dot pattern" },
  { key: "coral", label: "Coral", spec: "F=0.039 K=0.058 — branching growth" },
  { key: "waves", label: "Waves", spec: "F=0.026 K=0.051 — traveling waves" },
  { key: "bacteria", label: "Bacteria", spec: "F=0.078 K=0.061 — chaotic" },
];

function Tile({
  label,
  spec,
  children,
}: {
  label: string;
  spec: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="border-2 border-foreground bg-card">
      <div className="relative h-48 overflow-hidden bg-background">{children}</div>
      <figcaption className="border-t-2 border-foreground p-3 space-y-1">
        <div className="font-display text-base uppercase tracking-tight font-black">{label}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {spec}
        </div>
      </figcaption>
    </figure>
  );
}

function PreviewFields() {
  return (
    <div className="space-y-12 pb-12 animate-fade-in">
      <header className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          agency · preview · generative fields
        </div>
        <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-tight font-black leading-[0.95]">
          Field algorithms
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground leading-relaxed">
          Variants of the home-page background field. Gray-Scott reaction-diffusion presets first,
          then three algorithmically different fields.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          gray-scott · parameter presets
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {RD_PRESETS.map((p) => (
            <Tile key={p.key} label={p.label} spec={p.spec}>
              <ReactionDiffusionField
                preset={p.key}
                className="absolute inset-0 w-full h-full pointer-events-none"
              />
            </Tile>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          alternative algorithms
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Tile label="Cyclic CA" spec="12 states · 4-neighbor — rings & spirals">
            <CyclicCAField className="absolute inset-0 w-full h-full pointer-events-none" />
          </Tile>
          <Tile label="Worley" spec="28 drifting seeds · edge distance — cellular noise">
            <WorleyField className="absolute inset-0 w-full h-full pointer-events-none" />
          </Tile>
          <Tile label="Flow field" spec="220 particles · curl-noise — wind survey">
            <FlowField className="absolute inset-0 w-full h-full pointer-events-none" />
          </Tile>
        </div>
      </section>
    </div>
  );
}
