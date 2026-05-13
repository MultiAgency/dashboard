import type * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex w-full min-h-20 border-2 border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
