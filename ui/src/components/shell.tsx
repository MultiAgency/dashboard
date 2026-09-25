import { ArrowLeftIcon, ListIcon } from "@phosphor-icons/react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import type * as React from "react";
import type { ReactNode } from "react";
import { AuthHashToasts } from "@/components/auth-hash-toasts";
import { NetworkToggle } from "@/components/network-toggle";
import { NotificationsBell } from "@/components/notifications-bell";
import { OrgSwitcher } from "@/components/org-switcher";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserNav } from "@/components/user-nav";
import { useMeRoles } from "@/hooks/use-me-roles";
import { cn } from "@/lib/utils";

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
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-foreground focus:text-background text-xs"
        >
          Skip to content
        </a>
        <header className="shrink-0 bg-card/50">
          <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
            <Link
              to="/"
              aria-label={`${brandName} home`}
              className="flex size-7 shrink-0 items-center hover:opacity-70 transition-opacity duration-150"
            >
              <Logo />
            </Link>

            <nav aria-label="Primary" className="hidden sm:flex items-center gap-1">
              {PRIMARY_NAV.map((item) => (
                <NavLink key={item.to} item={item} active={linkActive(item.to)} />
              ))}
            </nav>

            <div className="flex shrink-0 items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="sm:hidden"
                    aria-label="Open menu"
                  >
                    <ListIcon aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {PRIMARY_NAV.map((item) => (
                    <DropdownMenuItem key={item.to} asChild>
                      <Link to={item.to}>{item.label}</Link>
                    </DropdownMenuItem>
                  ))}
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
      aria-current={active ? "page" : undefined}
      className={`inline-flex h-7 items-center px-2 text-xs font-medium leading-none transition-colors duration-150 ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
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
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {eyebrow}
        </div>
        <h1 className="text-5xl sm:text-6xl font-black uppercase leading-none tracking-tight">
          {headline}
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">{body}</p>
        <div className="pt-2">
          <Button asChild variant="outline">
            <Link to={ctaTo}>
              <ArrowLeftIcon data-icon="inline-start" aria-hidden />
              {ctaLabel}
            </Link>
          </Button>
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
      ctaLabel="back to home"
    />
  );
}

export function AppRouteError() {
  return (
    <SignText
      eyebrow="agency · error"
      headline="off the rails"
      body="Something went wrong loading this page. Head back to home and try again."
      ctaLabel="back to home"
    />
  );
}

export function UnknownDoc() {
  return (
    <SignText
      eyebrow="agency · 404"
      headline="unknown doc"
      body="That entry isn't in the docs. Browse the index."
      ctaLabel="all docs"
      ctaTo="/docs"
    />
  );
}
