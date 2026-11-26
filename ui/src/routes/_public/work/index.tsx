import { createFileRoute } from "@tanstack/react-router";
import { WorkShowcase } from "@/components/work-showcase/work-showcase";

export const Route = createFileRoute("/_public/work/")({
  head: () => ({
    meta: [
      { title: "Work Done by MultiAgency" },
      { name: "description", content: "Apps, developer tools, and communities built across NEAR." },
    ],
  }),
  component: WorkShowcase,
});
