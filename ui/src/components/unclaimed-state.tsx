import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { getRepoUrl } from "@/lib/repo";

export function UnclaimedState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-12 pb-12 animate-fade-in">
      <section className="pt-8 sm:pt-16">
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            template instance · unclaimed
          </div>
          <h1 className="font-display text-5xl font-black uppercase leading-none tracking-tight sm:text-7xl">
            {title}
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            This dashboard hasn't been pointed at a Sputnik DAO yet. {children}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button asChild className="font-display uppercase tracking-wide">
              <a href={getRepoUrl()} target="_blank" rel="noopener noreferrer">
                clone the template →
              </a>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
