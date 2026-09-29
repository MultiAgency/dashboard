import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  CompassIcon,
  FileXIcon,
  ListIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import type * as React from "react";
import type { ReactNode } from "react";
import { AuthHashToasts } from "@/components/auth-hash-toasts";
import { NetworkToggle } from "@/components/network-toggle";
import { NotificationsBell } from "@/components/notifications-bell";
import { OrgSwitcher } from "@/components/org-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
  { to: "/work", label: "Work" },
  { to: "/treasury", label: "Treasury" },
  { to: "/docs", label: "Docs" },
];

export function Shell({ children }: { children: ReactNode }) {
  const matchRoute = useMatchRoute();
  const { isAuthenticated } = useMeRoles();

  const brandName = "MultiAgency";

  const linkActive = (to: string) => Boolean(matchRoute({ to, fuzzy: true }));

  return (
    <div className="flex min-h-screen w-full flex-col bg-pattern text-foreground">
      <AuthHashToasts />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-foreground focus:px-3 focus:py-2 focus:text-xs focus:text-background"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 shrink-0 border-b bg-background/75 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
          <Link
            to="/"
            aria-label={`${brandName} home`}
            className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-70"
          >
            <span className="flex size-6">
              <Logo />
            </span>
            <span className="hidden font-heading text-sm font-semibold tracking-tight md:inline">
              {brandName}
            </span>
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
            {PRIMARY_NAV.map((item) => (
              <NavLink key={item.to} item={item} active={linkActive(item.to)} />
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            {isAuthenticated && <OrgSwitcher />}
            {isAuthenticated && <NotificationsBell />}
            <NetworkToggle />
            <ThemeToggle />
            <UserNav />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="sm:hidden" aria-label="Open menu">
                  <ListIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {PRIMARY_NAV.map((item) => (
                  <DropdownMenuItem key={item.to} asChild>
                    <Link to={item.to} aria-current={linkActive(item.to) ? "page" : undefined}>
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main id="main" className="w-full flex-1">
        <div className="mx-auto w-full max-w-5xl animate-fade-in-up px-4 py-8 sm:px-6 sm:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Button asChild variant={active ? "secondary" : "ghost"} size="sm">
      <Link to={item.to} aria-current={active ? "page" : undefined}>
        {item.label}
      </Link>
    </Button>
  );
}

type StatusPageProps = {
  icon: ReactNode;
  code: string;
  title: string;
  description: string;
  action: ReactNode;
};

function StatusPage({ icon, code, title, description, action }: StatusPageProps) {
  return (
    <Empty className="min-h-96">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <Badge variant="outline">{code}</Badge>
        <EmptyTitle>
          <h1>{title}</h1>
        </EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>{action}</EmptyContent>
    </Empty>
  );
}

function BackLink({ to, label }: { to: "/" | "/docs"; label: string }) {
  return (
    <Button asChild variant="outline">
      <Link to={to}>
        <ArrowLeftIcon data-icon="inline-start" aria-hidden />
        {label}
      </Link>
    </Button>
  );
}

export function AppNotFound() {
  return (
    <StatusPage
      icon={<CompassIcon aria-hidden />}
      code="404"
      title="Page not found"
      description="This page doesn't exist or has moved."
      action={<BackLink to="/" label="Back to home" />}
    />
  );
}

export function AppRouteError({ onRetry }: { onRetry?: () => void }) {
  return (
    <StatusPage
      icon={<WarningCircleIcon aria-hidden />}
      code="Error"
      title="Something went wrong"
      description="This page failed to load. Try again, or head back to home."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          {onRetry && (
            <Button type="button" onClick={onRetry}>
              <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
              Try again
            </Button>
          )}
          <BackLink to="/" label="Back to home" />
        </div>
      }
    />
  );
}

export function UnknownDoc() {
  return (
    <StatusPage
      icon={<FileXIcon aria-hidden />}
      code="404"
      title="Doc not found"
      description="That entry isn't in the docs. Browse the index instead."
      action={<BackLink to="/docs" label="All docs" />}
    />
  );
}
