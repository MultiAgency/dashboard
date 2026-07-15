import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { Button } from "@/components";
import { UnknownDoc } from "@/components/shell";
import { type DocEntry, findDoc } from "@/lib/docs-registry";

type DocLoaderData = {
  doc: DocEntry | null;
  content: string | null;
  error: string | null;
};

async function loadDocPage(slug: string, assetsUrl: string): Promise<DocLoaderData> {
  const doc = findDoc(slug);

  if (!doc) {
    return { doc: null, content: null, error: null };
  }

  try {
    const res = await fetch(`${assetsUrl}/${doc.source}/${slug}.md`);
    if (!res.ok) {
      throw new Error(`Could not load ${slug}.md (${res.status})`);
    }

    const raw = await res.text();
    return {
      doc,
      content: raw.replace(/^---\n[\s\S]*?\n---\n/, ""),
      error: null,
    };
  } catch (error) {
    return {
      doc,
      content: null,
      error: error instanceof Error ? error.message : "Could not load document",
    };
  }
}

export const Route = createFileRoute("/_layout/docs/$slug")({
  head: ({ params }) => {
    const doc = findDoc(params.slug);
    return {
      meta: [{ title: doc ? `${doc.title} · Docs` : "Docs" }],
    };
  },
  loader: ({ params, context }) => loadDocPage(params.slug, context.runtimeConfig?.assetsUrl || ""),
  component: DocPage,
});

let mermaidReady: Promise<typeof import("mermaid")> | null = null;

function loadMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        theme: document.documentElement.classList.contains("dark") ? "dark" : "neutral",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        themeVariables: {
          fontSize: "16px",
        },
        flowchart: {
          curve: "linear",
          padding: 20,
          nodeSpacing: 36,
          rankSpacing: 48,
          htmlLabels: true,
          useMaxWidth: true,
        },
      });
      return mod;
    });
  }
  return mermaidReady;
}

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await loadMermaid();
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mod.default.render(id, code.trim());
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (failed) {
    return (
      <pre className="font-mono text-sm bg-muted border border-border p-4 overflow-x-auto rounded-sm">
        {code}
      </pre>
    );
  }

  return (
    <div
      ref={ref}
      className="my-6 overflow-x-auto rounded-sm border border-border bg-muted/20 p-6 [&_svg]:mx-auto [&_svg]:max-w-full [&_foreignObject_div]:text-center [&_foreignObject_span]:text-center"
    />
  );
}

function DocPage() {
  const loaderData = Route.useLoaderData() as DocLoaderData;
  const doc = loaderData?.doc;
  const content = loaderData?.content ?? null;
  const error = loaderData?.error ?? null;
  const navigate = useNavigate();

  if (!doc) {
    return <UnknownDoc />;
  }

  const eyebrow = doc.section === "skills" ? "agency · skill" : "agency · model";
  const showRegistryTitle = !!content && !/^\s*#\s/.test(content);

  return (
    <div className="w-full max-w-3xl mx-auto px-1 sm:px-0 space-y-4 animate-fade-in">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          {eyebrow}
        </div>
        {showRegistryTitle && (
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-black uppercase leading-none tracking-tight">
            {doc.title}
          </h1>
        )}
      </header>

      {error ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          could not load — try again
        </p>
      ) : !content ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          loading…
        </p>
      ) : (
        <article className="space-y-5 text-base leading-7">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              h1: ({ children }) => (
                <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-black uppercase leading-none tracking-tight mt-0 mb-3">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="font-display text-2xl sm:text-3xl uppercase tracking-tight font-bold leading-tight mt-10 mb-3 border-b border-border pb-2">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="font-display text-lg sm:text-xl uppercase tracking-tight font-bold leading-tight mt-8 mb-2">
                  {children}
                </h3>
              ),
              h4: ({ children }) => (
                <h4 className="font-display text-base uppercase tracking-tight font-semibold mt-6 mb-2">
                  {children}
                </h4>
              ),
              p: ({ children }) => (
                <p className="text-base leading-7 text-foreground/90">{children}</p>
              ),
              ul: ({ children }) => (
                <ul className="list-disc pl-6 space-y-2 text-base leading-7 text-foreground/90">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal pl-6 space-y-2 text-base leading-7 text-foreground/90">
                  {children}
                </ol>
              ),
              li: ({ children }) => <li className="leading-7">{children}</li>,
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
                    className="underline underline-offset-2 text-foreground hover:text-muted-foreground"
                  >
                    {children}
                  </a>
                );
              },
              code: ({ className, children, ...props }) => {
                const match = /language-(\w+)/.exec(className || "");
                const lang = match?.[1];
                const text = String(children).replace(/\n$/, "");
                if (lang === "mermaid") {
                  return <MermaidBlock code={text} />;
                }
                const isInline = !className;
                if (isInline) {
                  return (
                    <code className="font-mono text-[0.875em] bg-muted px-1.5 py-0.5 border border-border rounded-sm">
                      {children}
                    </code>
                  );
                }
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => {
                const child = children as ReactNode;
                if (
                  child &&
                  typeof child === "object" &&
                  "props" in (child as { props?: { className?: string } })
                ) {
                  const cls = (child as { props?: { className?: string } }).props?.className || "";
                  if (cls.includes("language-mermaid")) {
                    return <>{children}</>;
                  }
                }
                return (
                  <pre className="font-mono text-sm leading-6 bg-muted border border-border p-4 overflow-x-auto rounded-sm my-4">
                    {children}
                  </pre>
                );
              },
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-foreground/40 pl-4 my-4 text-base text-muted-foreground italic">
                  {children}
                </blockquote>
              ),
              table: ({ children }) => (
                <div className="overflow-x-auto my-4 -mx-1 sm:mx-0">
                  <table className="w-full text-sm border-collapse border border-border min-w-[20rem]">
                    {children}
                  </table>
                </div>
              ),
              th: ({ children }) => (
                <th className="font-mono text-[11px] uppercase tracking-wide border border-border bg-muted px-3 py-2 text-left">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-border px-3 py-2 align-top text-sm leading-6">
                  {children}
                </td>
              ),
              hr: () => <hr className="border-t-2 border-foreground/20 my-8" />,
            }}
          >
            {content}
          </ReactMarkdown>
        </article>
      )}

      <div className="pt-6 border-t-2 border-foreground/15">
        <Button asChild variant="outline" size="sm">
          <Link to="/docs">← all docs</Link>
        </Button>
      </div>
    </div>
  );
}
