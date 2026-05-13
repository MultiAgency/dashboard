import { cva, type VariantProps } from "class-variance-authority";
import { Slot as SlotPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "bg-foreground text-background border-2 border-foreground hover:bg-foreground/85 active:bg-foreground/70",
        primary:
          "bg-accent text-accent-foreground border-2 border-foreground hover:bg-foreground hover:text-background active:bg-foreground/85",
        destructive:
          "bg-destructive text-destructive-foreground border-2 border-destructive hover:bg-destructive/85 active:bg-destructive/70",
        outline:
          "bg-card text-foreground border-2 border-foreground hover:bg-foreground hover:text-background active:bg-foreground/85",
        secondary:
          "bg-secondary text-secondary-foreground border-2 border-border hover:bg-secondary/85 active:bg-secondary/70",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "font-mono uppercase tracking-[0.18em] text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 px-3 py-1.5 has-[>svg]:px-2.5 text-xs",
        lg: "h-12 px-6 py-3 has-[>svg]:px-4",
        icon: "size-10",
        "icon-sm": "size-8",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? SlotPrimitive.Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
