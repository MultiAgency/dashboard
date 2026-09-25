import type { ComponentProps } from "react";
import { TabsList } from "@/components/ui/tabs";

export function ScrollableTabsList(props: Omit<ComponentProps<typeof TabsList>, "variant">) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      <TabsList variant="line" {...props} />
    </div>
  );
}
