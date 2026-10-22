import { Badge } from "@/components/ui/badge";
import type { Evidence } from "./work-order-status";

const GROUPS: { title: string; match: (e: Evidence) => boolean }[] = [
  { title: "Assigned issues (authorization)", match: (e) => e.kind === "assigned_issue" },
  { title: "Merged pull requests", match: (e) => e.kind === "merged_pr" },
  { title: "Other merged work (needs confirmation)", match: (e) => e.kind === "unlinked_pr" },
  { title: "Reviews", match: (e) => e.kind === "review" },
];

const STATE_LABEL: Record<string, string> = {
  done: "Done",
  in_progress: "In progress",
  not_started: "Not started",
  merged: "Merged",
};

export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing collected yet. Evidence comes from GitHub: issues assigned to the builder, pull
        requests the repository owner approved or merged, and reviews.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {GROUPS.map((group) => {
        const items = evidence.filter(group.match);
        if (items.length === 0) return null;
        return (
          <section key={group.title} className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {group.title}
            </h3>
            <ul className="flex flex-col divide-y border">
              {items.map((item) => (
                <li key={item.id} className="flex flex-col gap-1 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {item.repo ? `${item.repo}#${item.number}` : item.title}
                    </a>
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <Badge variant={item.authorized ? "outline" : "default"}>
                      {item.authorized
                        ? (STATE_LABEL[item.state] ?? item.state)
                        : "Needs confirmation"}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {item.occurredAt && <span>{item.occurredAt.slice(0, 10)}</span>}
                    {item.assignedBy && <span>assigned by @{item.assignedBy}</span>}
                    {item.links.length > 0 && <span>closes {item.links.join(", ")}</span>}
                    {item.flags.map((flag) => (
                      <span key={flag} className="text-destructive">
                        {flag}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
