import type * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full border-2 border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
