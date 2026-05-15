import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import { GithubIcon, NearWordmark, XIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserNav } from "@/components/user-nav";
import { useClientValue } from "@/hooks/use-client";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { publicSettingsQueryOptions } from "@/lib/queries";
import { getRepoUrl } from "@/lib/repo";

type NavItem = { to: string; label: string };

const PRIMARY_NAV: NavItem[] = [
  { to: "/work", label: "work" },
  { to: "/treasury", label: "treasury" },
  { to: "/docs", label: "docs" },
];

const SETTINGS_ITEM: NavItem = { to: "/settings", label: "settings" };

export function Shell({ children }: { children: ReactNode }) {
  const pathname = useClientValue(() => window.location.pathname, "/");
  const apiClient = useApiClient();
  const { isAuthenticated, isAdmin } = useMeRoles();

  const publicSettingsQuery = useQuery(publicSettingsQueryOptions(apiClient));
  const brandName = publicSettingsQuery.data?.name?.trim() || "MultiAgency";

  const linkActive = (to: string) => pathname === to;

  return (
    <div className="min-h-screen w-full flex bg-background text-foreground">
      <div className="flex-1 flex flex-col min-w-0">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-foreground focus:text-background font-mono text-[11px] uppercase tracking-[0.22em]"
        >
          Skip to content
        </a>
        <header className="shrink-0 bg-card/50">
          <div className="flex items-center justify-between gap-4 px-4 sm:px-6 h-14">
            <Link
              to="/"
              aria-label={`${brandName} home`}
              className="shrink-0 hover:opacity-70 transition-opacity duration-150"
            >
              <Logo className="w-7 h-7" />
            </Link>

            <nav className="hidden sm:flex items-center gap-6">
              {PRIMARY_NAV.map((item) => (
                <NavLink key={item.to} item={item} active={linkActive(item.to)} />
              ))}
              {isAdmin && <NavLink item={SETTINGS_ITEM} active={linkActive(SETTINGS_ITEM.to)} />}
              <a
                href={getRepoUrl()}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="github"
                className="text-muted-foreground hover:text-foreground transition-colors duration-150"
              >
                <GithubIcon className="size-4" />
              </a>
              <a
                href="https://x.com/_multiagency"
                target="_blank"
                rel="me noopener noreferrer"
                aria-label="x"
                className="text-muted-foreground hover:text-foreground transition-colors duration-150"
              >
                <XIcon className="size-4" />
              </a>
            </nav>

            <div className="flex items-center gap-2 shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="sm:hidden flex cursor-pointer items-center justify-center size-8 text-muted-foreground hover:text-foreground hover:opacity-80 transition-opacity duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label="Open menu"
                >
                  <Menu className="size-5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {PRIMARY_NAV.map((item) => (
                    <DropdownMenuItem key={item.to} asChild>
                      <Link to={item.to} className="font-mono text-xs uppercase tracking-wide">
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem asChild>
                    <a
                      href={getRepoUrl()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs uppercase tracking-wide"
                    >
                      github
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a
                      href="https://x.com/_multiagency"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs uppercase tracking-wide"
                    >
                      x
                    </a>
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem asChild>
                      <Link
                        to={SETTINGS_ITEM.to}
                        className="font-mono text-xs uppercase tracking-wide"
                      >
                        {SETTINGS_ITEM.label}
                      </Link>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <UserNav />
            </div>
          </div>
        </header>

        <main id="main" className="w-full">
          <div
            className={`w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 animate-fade-in-up ${isAuthenticated ? "max-w-5xl" : "max-w-4xl"}`}
          >
            {children}
          </div>
        </main>

        <footer className="shrink-0 flex justify-center py-6">
          <a
            href="https://near.dev"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Built on NEAR"
            className="flex items-center gap-2 h-10 text-foreground hover:opacity-70 transition-opacity duration-150"
          >
            <span className="font-display uppercase tracking-wide text-sm">Built on</span>
            <NearWordmark className="h-5" />
          </a>
        </footer>
      </div>
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      to={item.to}
      className={`font-mono text-[11px] uppercase tracking-[0.22em] transition-colors duration-150 ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {item.label}
    </Link>
  );
}

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

export function NotFound() {
  return (
    <SignText
      eyebrow="agency · 404"
      headline="no record"
      body="That route isn't wired. Head back to home."
      ctaLabel="← back to home"
    />
  );
}

export function RouteError() {
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
      eyebrow="handbook · 404"
      headline="unknown doc"
      body="That entry isn't in the handbook. Browse the docs index."
      ctaLabel="← all docs"
      ctaTo="/docs"
    />
  );
}
