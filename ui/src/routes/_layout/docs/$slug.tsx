import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { Button } from "@/components";
import { UnknownDoc } from "@/components/shell";
import { findDoc } from "@/lib/docs-registry";
import { Route as RootRoute } from "../../__root";

export const Route = createFileRoute("/_layout/docs/$slug")({
  head: ({ params }) => {
    const doc = findDoc(params.slug);
    return {
      meta: [{ title: doc ? `${doc.title} · Docs` : "Docs" }],
    };
  },
  component: DocPage,
});

function DocPage() {
  const { slug } = Route.useParams();
  const doc = findDoc(slug);
  const loaderData = RootRoute.useLoaderData();
  const assetsUrl = loaderData?.assetsUrl ?? "";
  const navigate = useNavigate();

  const contentQuery = useQuery({
    queryKey: ["docs", slug, assetsUrl],
    queryFn: async () => {
      if (!doc) throw new Error("unknown");
      const res = await fetch(`${assetsUrl}/${doc.source}/${slug}.md`);
      if (!res.ok) throw new Error(`Could not load ${slug}.md (${res.status})`);
      const raw = await res.text();
      return raw.replace(/^---\n[\s\S]*?\n---\n/, "");
    },
    enabled: !!doc,
    staleTime: 5 * 60_000,
  });

  if (!doc) {
    return <UnknownDoc />;
  }

  const eyebrow = doc.section === "skills" ? "agency · skill" : "agency · model";
  // fall back to the registry title only when the markdown has no leading "# ..."
  const showRegistryTitle = contentQuery.isSuccess && !/^\s*#\s/.test(contentQuery.data ?? "");

  return (
    <div className="max-w-3xl mx-auto space-y-2 animate-fade-in">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          {eyebrow}
        </div>
        {showRegistryTitle && (
          <h1 className="font-display text-4xl sm:text-6xl font-black uppercase leading-none tracking-tight">
            {doc.title}
          </h1>
        )}
      </header>

      {contentQuery.isLoading ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          loading…
        </p>
      ) : contentQuery.isError ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          could not load — try again
        </p>
      ) : (
        <article className="space-y-4 text-sm leading-relaxed">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              h1: ({ children }) => (
                <h1 className="font-display text-4xl sm:text-6xl font-black uppercase leading-none tracking-tight mt-0 mb-2">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="font-display text-xl uppercase tracking-tight font-bold leading-tight mt-8 mb-2 border-b border-border pb-1">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="font-display text-base uppercase tracking-tight font-bold leading-tight mt-6 mb-2">
                  {children}
                </h3>
              ),
              p: ({ children }) => (
                <p className="text-sm leading-relaxed text-foreground/90">{children}</p>
              ),
              ul: ({ children }) => (
                <ul className="list-disc pl-6 space-y-1 text-sm leading-relaxed text-foreground/90">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal pl-6 space-y-1 text-sm leading-relaxed text-foreground/90">
                  {children}
                </ol>
              ),
              li: ({ children }) => <li>{children}</li>,
              a: ({ href, children }) => {
                const isInternal = !!href && href.startsWith("/");
                return (
                  <a
                    href={href}
                    {...(isInternal
                      ? {
                          onClick: (e) => {
                            if (
                              e.metaKey ||
                              e.ctrlKey ||
                              e.shiftKey ||
                              e.altKey ||
                              e.button !== 0
                            ) {
                              return;
                            }
                            e.preventDefault();
                            navigate({ to: href });
                          },
                        }
                      : { target: "_blank", rel: "noopener noreferrer" })}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {children}
                  </a>
                );
              },
              code: ({ children, ...props }) => {
                const isInline = !("data-language" in (props as Record<string, unknown>));
                if (isInline) {
                  return (
                    <code className="font-mono text-xs bg-muted px-1 py-0.5 border border-border">
                      {children}
                    </code>
                  );
                }
                return <code {...props}>{children}</code>;
              },
              pre: ({ children }) => (
                <pre className="font-mono text-xs bg-muted border border-border p-3 overflow-x-auto">
                  {children}
                </pre>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-foreground/40 pl-4 text-sm text-muted-foreground italic">
                  {children}
                </blockquote>
              ),
              table: ({ children }) => (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse border border-border">
                    {children}
                  </table>
                </div>
              ),
              th: ({ children }) => (
                <th className="font-mono text-[10px] uppercase tracking-wide border border-border bg-muted px-3 py-2 text-left">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-border px-3 py-2 align-top">{children}</td>
              ),
              hr: () => <hr className="border-t-2 border-foreground/20 my-6" />,
            }}
          >
            {contentQuery.data ?? ""}
          </ReactMarkdown>
        </article>
      )}

      <div className="pt-6 border-t-2 border-foreground/15">
        <Button
          asChild
          variant="outline"
          size="sm"
          className="font-display uppercase tracking-wide"
        >
          <Link to="/docs">← all docs</Link>
        </Button>
      </div>
    </div>
  );
}
