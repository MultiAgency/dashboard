import type * as React from "react";

import { cn } from "@/lib/utils";

export function GithubIcon({ className, ...props }: React.ComponentProps<"svg">) {
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

export function XIcon({ className, ...props }: React.ComponentProps<"svg">) {
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
