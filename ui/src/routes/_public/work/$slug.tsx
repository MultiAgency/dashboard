import { ArrowLeftIcon, ArrowRightIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@/components";
import { workDemoProjects } from "@/lib/work-demo-projects";

export const Route = createFileRoute("/_public/work/$slug")({
  loader: ({ params }) => {
    const project = workDemoProjects.find(({ slug }) => slug === params.slug);
    if (!project) throw notFound();
    return project;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.title ?? "Project" },
      {
        name: "description",
        content: loaderData?.description ?? "A project MultiAgency is building.",
      },
    ],
  }),
  component: PublicProjectPage,
});

function PublicProjectPage() {
  const project = Route.useLoaderData();

  return (
    <div className="flex animate-fade-in flex-col gap-6">
      <Button asChild size="sm" variant="ghost" className="w-fit">
        <Link to="/work">
          <ArrowLeftIcon data-icon="inline-start" aria-hidden />
          Our work
        </Link>
      </Button>
      <PageHeader
        title={project.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>@{project.slug}</span>
            <Badge variant="outline">{project.status}</Badge>
          </span>
        }
        actions={
          project.repository &&
          project.repository !== project.preview.url && (
            <Button asChild variant="outline">
              <a href={project.repository} target="_blank" rel="noopener noreferrer">
                Project source
                <ArrowUpRightIcon data-icon="inline-end" aria-hidden />
              </a>
            </Button>
          )
        }
      />

      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {project.description}
      </p>

      <figure className="overflow-hidden border bg-card">
        <img
          src={project.preview.image}
          alt={`Screenshot of the ${project.preview.label} for ${project.title}`}
          width={1280}
          height={800}
          decoding="async"
          className="block h-auto w-full bg-muted"
        />
        <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
          <span className="text-xs text-muted-foreground">{project.preview.label}</span>
          <Button asChild size="sm" variant="ghost">
            <a href={project.preview.url} target="_blank" rel="noopener noreferrer">
              Open original
              <ArrowUpRightIcon data-icon="inline-end" aria-hidden />
            </a>
          </Button>
        </figcaption>
      </figure>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Work with us</h2>
          </CardTitle>
          <CardDescription>Want something like this built, or want to build it?</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/contact">
              Hire us
              <ArrowRightIcon data-icon="inline-end" aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/apply">Apply to contribute</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
