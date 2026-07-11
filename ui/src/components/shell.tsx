import { Link, useMatchRoute } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import type * as React from "react";
import type { ReactNode } from "react";
import { NetworkToggle } from "@/components/network-toggle";
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

function NearWordmark({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 345 86"
      fill="currentColor"
      aria-hidden="true"
      className={cn("h-5 w-auto", className)}
      {...props}
    >
      <path d="M48.4639 1.10645C39.1502 1.10645 32.3777 3.20312 26.624 8.03978L16.4631 16.4231C15.6162 17.0698 13.9225 17.5532 12.7394 16.5831C11.5526 15.6165 11.3847 14.3265 12.3999 13.0365L17.8177 5.29646C18.6646 4.16645 17.9893 2.71642 16.4631 2.71642H3.42574C1.90314 2.71642 0.716797 3.84643 0.716797 5.29646V80.7635C0.716797 82.2135 1.90314 83.3435 3.42574 83.3435H16.9709C18.4935 83.3435 19.6798 82.2135 19.6798 80.7635V38.193C19.6798 18.6832 36.7808 15.6198 43.2139 15.6198C56.9269 15.6198 61.8374 24.9732 61.8374 32.0663V80.7635C61.8374 82.2135 63.0238 83.3435 64.5464 83.3435H78.0911C79.6137 83.3435 80.8005 82.2135 80.8005 80.7635V30.4532C80.8005 12.3931 68.4421 1.10645 48.4639 1.10645Z" />
      <path d="M135.995 0.783203C109.752 0.783203 92.9902 16.1032 92.9902 36.9031V48.3535C92.9902 70.2833 109.752 85.2803 135.995 85.2803C159.189 85.2803 175.443 73.8303 177.137 58.3503C177.309 56.7368 176.122 55.6102 174.428 55.6102H161.223C160.036 55.6102 159.021 56.2568 158.681 57.3833C156.988 62.5435 149.032 70.2833 135.995 70.2833C122.957 70.2833 110.766 61.2534 110.935 48.3535L111.106 34.0035C111.274 23.2 123.128 15.7833 135.995 15.7833C147.678 15.7833 159.021 22.0733 160.204 32.3935C160.302 33.5868 159.441 34.6632 158.206 34.89L120.245 41.9068C118.722 42.2299 117.536 43.5199 117.536 45.1299V45.2899C117.536 46.7399 119.058 48.03 121.26 48.03H175.779C177.277 48.03 178.488 46.8736 178.488 45.4499V35.2935C178.488 16.1066 161.048 0.786544 135.991 0.786544L135.995 0.783203Z" />
      <path d="M230.464 0.781661C209.3 0.781661 191.016 12.5517 191.016 28.0317C191.016 29.3218 192.202 30.2883 193.725 30.2883H207.438C208.792 30.2883 209.807 29.3218 209.979 28.0317C211.333 20.9384 220.307 15.7784 229.957 15.7784C241.468 15.7784 249.26 22.5517 249.26 34.1619V48.1919C249.26 62.5419 238.084 69.7987 224.199 69.7987C213.363 69.7987 207.098 65.9286 207.098 59.6384C207.098 54.1551 210.147 49.4785 222.673 46.7384L240.79 42.0617C242.651 41.5782 243.33 40.1251 242.991 38.5151C242.823 37.2251 241.3 36.5785 239.942 36.5785H221.151C205.236 36.5785 189.15 46.2518 189.15 60.4418V62.6984C189.15 77.2119 203.542 84.7886 219.964 84.7886C230.461 84.7886 239.435 80.9185 245.021 76.4053L253.319 69.6321C254.674 68.502 256.028 68.502 257.211 69.6321C258.226 70.5986 257.887 72.0517 257.04 73.1787L251.961 80.7585C251.114 81.8886 251.79 83.3386 253.316 83.3386H265.506C267.029 83.3386 268.215 82.2085 268.215 80.7585V31.8983C268.215 13.195 254.163 0.77832 230.457 0.77832L230.464 0.781661Z" />
      <path d="M341.359 2.71973H322.393C315.792 2.71973 309.356 6.58971 304.784 10.2998L297.338 16.4264C296.491 17.0731 294.965 17.5564 293.95 16.7498C292.763 15.9431 292.256 14.3298 293.274 13.0397L298.692 5.29972C299.54 4.16971 298.864 2.71973 297.338 2.71973H284.64C283.117 2.71973 281.931 3.84973 281.931 5.29972V80.7665C281.931 82.2165 283.117 83.3466 284.64 83.3466H298.524C300.046 83.3466 301.233 82.2165 301.233 80.7665V42.0666C301.233 25.4565 308.344 18.0398 323.754 18.0398H341.359C342.881 18.0398 344.068 16.9098 344.068 15.4597V5.29972C344.068 3.84973 342.881 2.71973 341.359 2.71973Z" />
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
