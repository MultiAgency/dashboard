import { Link } from "@tanstack/react-router";

type SignTextProps = {
  eyebrow: string;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaTo?: string;
};

function SignText({ eyebrow, headline, body, ctaLabel, ctaTo = "/" }: SignTextProps) {
  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="text-center space-y-6 max-w-md">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          {eyebrow}
        </div>
        <h1 className="font-display text-5xl sm:text-6xl font-black uppercase leading-none tracking-tight">
          {headline}
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">{body}</p>
        <div className="pt-2">
          <Link
            to={ctaTo}
            className="inline-flex items-center justify-center font-display uppercase tracking-wide border-2 border-foreground bg-card text-foreground hover:bg-foreground hover:text-background transition-colors duration-150 h-10 px-4 text-sm"
          >
            {ctaLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}

export function AppNotFound() {
  return (
    <SignText
      eyebrow="agency · 404"
      headline="no record"
      body="That route isn't wired. Head back to home."
      ctaLabel="← back to home"
    />
  );
}

export function AppRouteError() {
  return (
    <SignText
      eyebrow="agency · error"
      headline="off the rails"
      body="Something went wrong loading this page. Head back to home and try again."
      ctaLabel="← back to home"
    />
  );
}

export function UnknownDoc() {
  return (
    <SignText
      eyebrow="agency · 404"
      headline="unknown doc"
      body="That entry isn't in the docs. Browse the index."
      ctaLabel="← all docs"
      ctaTo="/docs"
    />
  );
}
