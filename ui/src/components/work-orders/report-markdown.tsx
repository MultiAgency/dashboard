import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function ReportMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h3 className="font-heading text-base font-semibold">{children}</h3>
          ),
          h2: ({ children }) => (
            <h4 className="mt-2 font-heading text-sm font-semibold">{children}</h4>
          ),
          h3: ({ children }) => (
            <h5 className="mt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {children}
            </h5>
          ),
          p: ({ children }) => <p className="text-pretty">{children}</p>,
          ul: ({ children }) => <ul className="flex list-disc flex-col gap-1 pl-5">{children}</ul>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="border-border" />,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
