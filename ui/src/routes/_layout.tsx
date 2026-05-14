import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { BookOpen, Menu } from "lucide-react";
import type { ReactNode } from "react";
import builtOn from "@/assets/built_on.png";
import builtOnRev from "@/assets/built_on_rev.png";
import { GithubIcon, XIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useClientValue } from "@/hooks/use-client";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { getRepoUrl } from "@/lib/repo";
import { Logo } from "../components";
import { UserNav } from "../components/user-nav";

type NavItem = { to: string; label: string };

const SETTINGS_ITEM: NavItem = { to: "/settings", label: "settings" };

export const Route = createFileRoute("/_layout")({
  beforeLoad: async ({ context }) => {
    // Conditional prefetch: warm meRoles cache for signed-in visitors on public routes
    // so operator sections don't flash. Skipped for visitors (no session, wasted RPC).
    if (context.session) {
      await context.queryClient.ensureQueryData({
        queryKey: ["me", "roles"],
        queryFn: () => context.apiClient.me.roles(),
        staleTime: 60_000,
        retry: false,
      });
    }
  },
  component: Layout,
  // In-subtree not-found (e.g. /work/junk); top-level misses hit __root's handler.
  notFoundComponent: NotFound,
});

function Layout() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = useClientValue(() => window.location.pathname, "/");
  const apiClient = useApiClient();
  const { isAuthenticated, isAdmin, isOperator } = useMeRoles();

  const publicSettingsQuery = useQuery({
    queryKey: ["settings", "public"],
    queryFn: () => apiClient.settings.getPublic(),
    staleTime: 5 * 60_000,
  });
  const brandName = publicSettingsQuery.data?.name?.trim() || "MultiAgency";

  const primaryNav: NavItem[] = [
    { to: "/work", label: "work" },
    { to: "/team", label: "team" },
    { to: "/payouts", label: "payouts" },
    { to: "/treasury", label: "treasury" },
  ];
  if (!isAuthenticated) primaryNav.push({ to: "/apply", label: "join" });
  if (!isOperator) primaryNav.push({ to: "/contact", label: "hire" });

  const linkActive = (to: string) => pathname === to;

  return (
    <div className="min-h-screen w-full flex bg-background text-foreground">
      <div className="flex-1 flex flex-col min-w-0">
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
              {primaryNav.map((item) => (
                <NavLink key={item.to} item={item} active={linkActive(item.to)} />
              ))}
              {isAdmin && <NavLink item={SETTINGS_ITEM} active={linkActive(SETTINGS_ITEM.to)} />}
              <Link
                to="/docs"
                aria-label="docs"
                className={`transition-colors duration-150 ${linkActive("/docs") ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <BookOpen className="size-4" />
              </Link>
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
                rel="noopener noreferrer"
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
                  {primaryNav.map((item) => (
                    <DropdownMenuItem key={item.to} asChild>
                      <Link to={item.to} className="font-mono text-xs uppercase tracking-wide">
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem asChild>
                    <Link to="/docs" className="font-mono text-xs uppercase tracking-wide">
                      docs
                    </Link>
                  </DropdownMenuItem>
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

        <main className="w-full">
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
            className="relative h-10 w-[160px]"
          >
            <img
              src={builtOn}
              alt="Built on NEAR"
              className="absolute inset-0 h-full w-full object-contain dark:hidden"
            />
            <img
              src={builtOnRev}
              alt="Built on NEAR"
              className="absolute inset-0 hidden h-full w-full object-contain dark:block"
            />
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

export function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="text-center space-y-6 max-w-md">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          agency · 404
        </div>
        <h1 className="font-display text-5xl sm:text-6xl font-black uppercase leading-none tracking-tight">
          no record
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          That route isn't wired. Head back to home.
        </p>
        <div className="pt-2">
          <Link
            to="/"
            className="inline-flex items-center justify-center font-display uppercase tracking-wide border-2 border-foreground bg-card text-foreground hover:bg-foreground hover:text-background transition-colors duration-150 h-10 px-4 text-sm"
          >
            ← back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
