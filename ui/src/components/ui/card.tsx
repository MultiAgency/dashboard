import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const cardVariants = cva("bg-card text-card-foreground flex flex-col border-2 border-border", {
  variants: {
    variant: {
      default: "",
      "hi-vis": "border-l-[6px] border-l-accent",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

function Card({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
  return <div data-slot="card" className={cn(cardVariants({ variant }), className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("p-6", className)} {...props} />;
}

export { Card, CardContent, cardVariants };
