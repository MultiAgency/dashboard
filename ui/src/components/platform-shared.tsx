import { Badge, Button, Card, CardContent } from "@/components";

export type PlatformProject = {
  id: string;
  slug: string;
  title: string;
  kind: "project" | "idea";
  status: string;
  visibility: string;
  repository: string | null;
};

export const TAB_BASE =
  "font-mono text-[11px] uppercase tracking-[0.18em] px-3 py-1.5 rounded-sm transition-colors";
export const TAB_ACTIVE = "bg-foreground text-background";
export const TAB_INACTIVE = "text-muted-foreground hover:text-foreground";

export const LABEL_CLS =
  "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground block";

export function orgSiteUrl(slug: string) {
  return `http://${slug}.localhost:3000/work`;
}

export function ProjectRow({ project, orgSlug }: { project: PlatformProject; orgSlug: string }) {
  return (
    <Card>
      <CardContent className="p-3 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="font-display text-sm uppercase tracking-tight font-bold truncate">
            {project.title}
          </div>
          <div className="font-mono text-xs text-muted-foreground truncate">/{project.slug}</div>
        </div>
        <Badge variant="outline" className="font-mono text-[10px] uppercase">
          {project.kind}
        </Badge>
        <Badge variant="outline" className="font-mono text-[10px] uppercase">
          {project.status}
        </Badge>
        <Badge variant="outline" className="font-mono text-[10px] uppercase">
          {project.visibility}
        </Badge>
        <a href={orgSiteUrl(orgSlug)} target="_blank" rel="noreferrer">
          <Button size="sm" variant="ghost">
            view org →
          </Button>
        </a>
      </CardContent>
    </Card>
  );
}
