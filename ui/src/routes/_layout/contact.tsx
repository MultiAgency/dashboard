import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";

export const Route = createFileRoute("/_layout/contact")({
  head: () => ({
    meta: [{ title: "Contact" }, { name: "description", content: "Hire the agency. Talk to us." }],
  }),
  component: Contact,
});

function Contact() {
  const apiClient = useApiClient();
  const { isAdmin, isLoaded } = useMeRoles();

  const settingsQuery = useQuery({
    queryKey: ["settings", "public"],
    queryFn: () => apiClient.settings.getPublic(),
    staleTime: 5 * 60_000,
  });

  const s = settingsQuery.data;
  const contactEmail = s?.contactEmail?.trim() || null;

  return (
    <div className="space-y-12 pb-12 animate-fade-in">
      <section className="relative pt-4 sm:pt-12">
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            agency · hire
          </div>
          <h1 className="font-display text-5xl font-black uppercase leading-none tracking-tight sm:text-7xl">
            Talk to us
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Tell us what you need. We will follow up.
          </p>
          {contactEmail ? (
            <div className="flex flex-col items-center gap-3 pt-2">
              <Button asChild className="font-display uppercase tracking-wide">
                <a href={`mailto:${contactEmail}`}>email us →</a>
              </Button>
              <a
                href={`mailto:${contactEmail}`}
                className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground hover:text-foreground"
              >
                {contactEmail}
              </a>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 pt-2">
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                Our contact channel is coming online soon. If you'd like to work with us, apply
                directly.
              </p>
              <Button asChild variant="outline" className="font-display uppercase tracking-wide">
                <Link to="/apply">apply →</Link>
              </Button>
            </div>
          )}
          {isLoaded && isAdmin && (
            <div className="pt-2">
              <Link
                to="/settings"
                hash="contact"
                className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground hover:text-foreground"
              >
                edit contact →
              </Link>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
