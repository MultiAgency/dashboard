import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components";
import type { WorkDemoProject } from "@/lib/work-demo-projects";

export function WorkProjectList({
  projects,
  heading: Heading,
}: {
  projects: readonly WorkDemoProject[];
  heading: "h2" | "h3";
}) {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <li key={project.slug} className="min-w-0">
          <Link
            to="/work/$slug"
            params={{ slug: project.slug }}
            className="group block h-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            <Card className="h-full gap-0 p-0 transition-shadow group-hover:ring-foreground/35">
              <img
                src={project.preview.image}
                alt=""
                width={1280}
                height={800}
                loading="lazy"
                decoding="async"
                className="aspect-[8/5] w-full border-b bg-muted object-cover object-top"
              />
              <CardHeader className="flex items-start justify-between gap-3 pt-4">
                <CardTitle className="text-base leading-snug">
                  <Heading>{project.title}</Heading>
                </CardTitle>
                <ArrowRightIcon
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground"
                />
              </CardHeader>
              <CardContent className="flex flex-1 flex-col items-start gap-4 pb-4 pt-2">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {project.description}
                </p>
                <Badge variant="outline" className="mt-auto">
                  {project.status}
                </Badge>
              </CardContent>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
