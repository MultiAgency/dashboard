import { CaretRightIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sync = () => {
      if (window.location.hash === `#${id}`) setOpen(true);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [id]);

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <section id={id} className="scroll-mt-24 border bg-card">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="group/section flex w-full items-start gap-3 px-4 py-4 text-left hover:bg-muted/50"
          >
            <CaretRightIcon
              aria-hidden
              className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/section:rotate-90"
            />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="font-medium">{title}</span>
              <span className="text-sm text-muted-foreground">{description}</span>
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t p-4">{children}</CollapsibleContent>
      </section>
    </Collapsible>
  );
}
