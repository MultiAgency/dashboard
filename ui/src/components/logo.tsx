import type * as React from "react";

import { cn } from "@/lib/utils";

export function Logo({ className, ...props }: React.ComponentProps<"svg">) {
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
