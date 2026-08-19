import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Input } from "@/components";
import { TokenAmountCell } from "@/components/token-amounts";
import { type CsvColumn, csvTimestamp, downloadCsv } from "@/lib/csv";
import { formatTokenAmount } from "@/lib/format-amount";
import {
  collectReportTokenIds,
  getTokenAmount,
  type TokenAmount,
  tokenDisplayName,
} from "@/lib/report-amounts";

export type ClientBreakdownItem = {
  clientName: string;
  projectTitle: string;
  projectSlug: string;
  budgetByToken: TokenAmount[];
  spentByToken: TokenAmount[];
};

type ClientGroup = {
  clientName: string;
  projects: ClientBreakdownItem[];
};

type ClientBreakdownCsvRow = {
  clientName: string;
  projectTitle: string;
  projectSlug: string;
  tokenLabel: string;
  tokenId: string;
  allocated: string;
  spent: string;
};

const SECTION_TITLE = "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground";

const TOKEN_TH =
  "font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground px-3 py-2 text-left border-b border-border";
const TOKEN_TD = "px-3 py-2 text-sm border-b border-border";

function groupByClient(breakdown: ClientBreakdownItem[]): ClientGroup[] {
  const map = new Map<string, ClientBreakdownItem[]>();
  for (const item of breakdown) {
    const list = map.get(item.clientName) ?? [];
    list.push(item);
    map.set(item.clientName, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([clientName, projects]) => ({
      clientName,
      projects: projects.sort(
        (a, b) =>
          a.projectTitle.localeCompare(b.projectTitle) ||
          a.projectSlug.localeCompare(b.projectSlug),
      ),
    }));
}

function flattenForCsv(breakdown: ClientBreakdownItem[]): ClientBreakdownCsvRow[] {
  const rows: ClientBreakdownCsvRow[] = [];
  for (const item of breakdown) {
    const tokenIds = collectReportTokenIds(item.budgetByToken, item.spentByToken);
    if (tokenIds.length === 0) {
      rows.push({
        clientName: item.clientName,
        projectTitle: item.projectTitle,
        projectSlug: item.projectSlug,
        tokenLabel: "—",
        tokenId: "—",
        allocated: "—",
        spent: "—",
      });
      continue;
    }
    for (const tokenId of tokenIds) {
      const allocated = getTokenAmount(item.budgetByToken, tokenId);
      const spent = getTokenAmount(item.spentByToken, tokenId);
      rows.push({
        clientName: item.clientName,
        projectTitle: item.projectTitle,
        projectSlug: item.projectSlug,
        tokenLabel: tokenDisplayName(tokenId),
        tokenId,
        allocated: allocated ? formatTokenAmount(allocated, tokenId) : "—",
        spent: spent ? formatTokenAmount(spent, tokenId) : "—",
      });
    }
  }
  return rows;
}

function matchesFilter(item: ClientBreakdownItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    item.clientName.toLowerCase().includes(q) ||
    item.projectTitle.toLowerCase().includes(q) ||
    item.projectSlug.toLowerCase().includes(q)
  );
}

function ProjectTokenTable({ item }: { item: ClientBreakdownItem }) {
  const tokenIds = collectReportTokenIds(item.budgetByToken, item.spentByToken);

  if (tokenIds.length === 0) {
    return <p className="text-sm text-muted-foreground px-1 py-2">No budget or spend recorded.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-sm border border-border">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th scope="col" className={TOKEN_TH}>
              Token
            </th>
            <th scope="col" className={TOKEN_TH}>
              Allocated
            </th>
            <th scope="col" className={TOKEN_TH}>
              Spent
            </th>
          </tr>
        </thead>
        <tbody>
          {tokenIds.map((tokenId) => (
            <tr key={tokenId} className="hover:bg-muted/20">
              <td className={TOKEN_TD}>
                <span className="font-medium" title={tokenId}>
                  {tokenDisplayName(tokenId)}
                </span>
              </td>
              <td className={TOKEN_TD}>
                <TokenAmountCell
                  amount={getTokenAmount(item.budgetByToken, tokenId)}
                  tokenId={tokenId}
                />
              </td>
              <td className={TOKEN_TD}>
                <TokenAmountCell
                  amount={getTokenAmount(item.spentByToken, tokenId)}
                  tokenId={tokenId}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type ClientBreakdownSectionProps = {
  breakdown: ClientBreakdownItem[];
};

export function ClientBreakdownSection({ breakdown }: ClientBreakdownSectionProps) {
  const [query, setQuery] = useState("");

  const filteredBreakdown = useMemo(
    () => breakdown.filter((item) => matchesFilter(item, query)),
    [breakdown, query],
  );

  const filteredGroups = useMemo(() => groupByClient(filteredBreakdown), [filteredBreakdown]);

  const csvRows = useMemo(() => flattenForCsv(filteredBreakdown), [filteredBreakdown]);

  const handleExport = () => {
    const columns: CsvColumn<ClientBreakdownCsvRow>[] = [
      { header: "Client", value: (r) => r.clientName },
      { header: "Project", value: (r) => r.projectTitle },
      { header: "Project slug", value: (r) => r.projectSlug },
      { header: "Token", value: (r) => r.tokenLabel },
      { header: "Allocated", value: (r) => r.allocated },
      { header: "Spent", value: (r) => r.spent },
    ];
    downloadCsv(`report-clients-${csvTimestamp()}.csv`, csvRows, columns);
  };

  const totalProjects = filteredGroups.reduce((n, g) => n + g.projects.length, 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className={SECTION_TITLE}>client breakdown</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {filteredGroups.length} client{filteredGroups.length === 1 ? "" : "s"} · {totalProjects}{" "}
            project{totalProjects === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter client or project…"
              className="pl-7 h-8 w-48 sm:w-64"
            />
          </div>
          <Button variant="outline" size="sm" onClick={handleExport}>
            export csv
          </Button>
        </div>
      </div>

      {filteredGroups.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            {query.trim() ? "No clients or projects match the filter." : "No client project data."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredGroups.map((group) => (
            <article
              key={group.clientName}
              className="rounded-sm border border-border overflow-hidden"
            >
              <header className="px-4 py-3 border-b border-border bg-muted/30">
                <h3 className="font-display text-lg font-black uppercase tracking-tight">
                  {group.clientName}
                </h3>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                  {group.projects.length} project{group.projects.length === 1 ? "" : "s"}
                </p>
              </header>

              <div className="divide-y divide-border">
                {group.projects.map((project) => (
                  <div
                    key={`${group.clientName}-${project.projectSlug}`}
                    className="px-4 py-4 space-y-3"
                  >
                    <div>
                      <h4 className="font-medium text-sm">{project.projectTitle}</h4>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        @{project.projectSlug}
                      </p>
                    </div>
                    <ProjectTokenTable item={project} />
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
