import { Link, useMatchRoute } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import type * as React from "react";
import type { ReactNode } from "react";
import { AuthHashToasts } from "@/components/auth-hash-toasts";
import { NetworkToggle } from "@/components/network-toggle";
import { NotificationsBell } from "@/components/notifications-bell";
import { OrgSwitcher } from "@/components/org-switcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserNav } from "@/components/user-nav";
import { useMeRoles } from "@/hooks/use-me-roles";
import { getRepoUrl } from "@/lib/repo";
import { cn } from "@/lib/utils";

function GithubIcon({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-4", className)}
      {...props}
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57v-2.025c-3.345.735-4.05-1.41-4.05-1.41-.54-1.395-1.32-1.77-1.32-1.77-1.08-.735.075-.735.075-.735 1.2.075 1.83 1.245 1.83 1.245 1.08 1.83 2.79 1.305 3.465.99.105-.78.42-1.305.78-1.605-2.67-.3-5.46-1.335-5.46-5.94 0-1.32.465-2.385 1.245-3.225-.135-.3-.555-1.545.105-3.225 0 0 1.02-.33 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.28-1.56 3.3-1.23 3.3-1.23.66 1.68.24 2.925.105 3.225.78.84 1.245 1.905 1.245 3.225 0 4.62-2.805 5.64-5.475 5.925.42.36.81 1.065.81 2.16v3.24c0 .315.225.69.825.57C20.565 21.795 24 17.31 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function XIcon({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-4", className)}
      {...props}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function Logo({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-full", className)}
      {...props}
    >
      <path
        fillRule="evenodd"
        d="M1 1L79 1L79 109L63 109L63 17L16 17L16 61L54 61L54 77L1 77ZM119 1L195 1L195 109L180 109L180 17L134 17L134 50L135 50L135 51L119 51ZM86 61L171 61L171 77L86 77ZM203 61L255 61L255 135L142 135L142 118L240 118L240 77L203 77ZM119 86L134 86L134 169L119 169ZM1 118L109 118L109 135L16 135L16 176L53 176L53 192L1 192ZM63 143L79 143L79 238L119 238L119 201L134 201L134 254L63 254ZM180 143L195 143L195 238L240 238L240 192L204 192L204 176L255 176L255 254L180 254ZM86 176L172 176L172 177L171 177L171 191L172 191L172 192L86 192Z"
      />
    </svg>
  );
}

type NavItem = { to: string; label: string };

const PRIMARY_NAV: NavItem[] = [
  { to: "/work", label: "work" },
  { to: "/treasury", label: "treasury" },
  { to: "/docs", label: "docs" },
];

export function Shell({ children }: { children: ReactNode }) {
  const matchRoute = useMatchRoute();
  const { isAuthenticated } = useMeRoles();

  const brandName = "MultiAgency";

  const linkActive = (to: string) =>
    Boolean(
      matchRoute({
        to,
        fuzzy: true,
      }),
    );

  return (
    <div className="min-h-screen w-full flex bg-background text-foreground">
      <AuthHashToasts />
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
                </DropdownMenuContent>
              </DropdownMenu>
              {isAuthenticated && <OrgSwitcher />}
              {isAuthenticated && <NotificationsBell />}
              <NetworkToggle />
              <UserNav />
            </div>
          </div>
        </header>

        <main id="main" className="w-full flex-1">
          <div
            className={`w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 animate-fade-in-up ${isAuthenticated ? "max-w-5xl" : "max-w-4xl"}`}
          >
            {children}
          </div>
        </main>
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
