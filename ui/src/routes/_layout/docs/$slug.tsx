import { ArrowLeftIcon } from "@phosphor-icons/react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import {
  Badge,
  Button,
  Separator,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import { LoadError } from "@/components/load-error";
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
      content: raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ""),
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
      <pre className="overflow-x-auto border bg-muted p-4 font-mono text-xs/relaxed">{code}</pre>
    );
  }

  return (
    <div
      ref={ref}
      className="overflow-x-auto border bg-muted/20 p-6 [&_svg]:mx-auto [&_svg]:max-w-full [&_foreignObject_div]:text-center [&_foreignObject_span]:text-center"
    />
  );
}

function DocPage() {
  const loaderData = Route.useLoaderData() as DocLoaderData;
  const doc = loaderData?.doc;
  const content = loaderData?.content ?? null;
  const error = loaderData?.error ?? null;
  const navigate = useNavigate();
  const router = useRouter();

  if (!doc) {
    return <UnknownDoc />;
  }

  const sectionLabel = doc.section === "skills" ? "Integration skill" : "Operating model";
  const showRegistryTitle = !content || !/^\s*#\s/.test(content);

  return (
    <div className="mx-auto flex w-full max-w-3xl animate-fade-in flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/docs">
            <ArrowLeftIcon data-icon="inline-start" aria-hidden />
            All docs
          </Link>
        </Button>
        <Badge variant="outline">{sectionLabel}</Badge>
      </div>

      {showRegistryTitle && (
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance">
          {doc.title}
        </h1>
      )}

      {error ? (
        <LoadError title="Could not load this doc" onRetry={() => void router.invalidate()} />
      ) : !content ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <article className="flex min-w-0 flex-col gap-4 text-sm/7">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              h1: ({ children }) => (
                <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="border-b pt-6 pb-2 font-heading text-xl font-semibold tracking-tight">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="pt-4 font-heading text-base font-semibold tracking-tight">
                  {children}
                </h3>
              ),
              h4: ({ children }) => (
                <h4 className="pt-2 font-heading text-sm font-semibold">{children}</h4>
              ),
              p: ({ children }) => <p className="text-pretty">{children}</p>,
              ul: ({ children }) => (
                <ul className="flex list-disc flex-col gap-2 pl-6">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="flex list-decimal flex-col gap-2 pl-6">{children}</ol>
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
                    className="font-medium underline underline-offset-4 hover:text-muted-foreground"
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
                  return <code className="bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>;
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
                  <pre className="overflow-x-auto border bg-muted p-4 font-mono text-xs/relaxed">
                    {children}
                  </pre>
                );
              },
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 pl-4 text-muted-foreground italic">
                  {children}
                </blockquote>
              ),
              table: ({ children }) => (
                <div className="border">
                  <Table>{children}</Table>
                </div>
              ),
              thead: ({ children }) => <TableHeader>{children}</TableHeader>,
              tbody: ({ children }) => <TableBody>{children}</TableBody>,
              tr: ({ children }) => <TableRow>{children}</TableRow>,
              th: ({ children }) => <TableHead>{children}</TableHead>,
              td: ({ children }) => (
                <TableCell className="align-top whitespace-normal">{children}</TableCell>
              ),
              hr: () => <Separator />,
            }}
          >
            {content}
          </ReactMarkdown>
        </article>
      )}

      <Separator />
      <div>
        <Button asChild variant="outline">
          <Link to="/docs">
            <ArrowLeftIcon data-icon="inline-start" aria-hidden />
            All docs
          </Link>
        </Button>
      </div>
    </div>
  );
}
