import { DownloadSimpleIcon, FunnelIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import { Empty } from "@/components/admin-form";
import { TokenAmountCell } from "@/components/token-amounts";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
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
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Client breakdown</h2>
        </CardTitle>
        <CardDescription>
          {filteredGroups.length} client{filteredGroups.length === 1 ? "" : "s"} · {totalProjects}{" "}
          project{totalProjects === 1 ? "" : "s"}, allocated and spent per token.
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <DownloadSimpleIcon data-icon="inline-start" aria-hidden />
            Export CSV
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon>
            <MagnifyingGlassIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter client or project…"
            aria-label="Filter client or project"
          />
        </InputGroup>

        {filteredGroups.length === 0 ? (
          <Empty
            icon={<FunnelIcon aria-hidden />}
            label={query.trim() ? "No clients or projects match" : "No client project data"}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Client</TableHead>
                <TableHead scope="col">Project</TableHead>
                <TableHead scope="col">Token</TableHead>
                <TableHead scope="col">Allocated</TableHead>
                <TableHead scope="col">Spent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredGroups.flatMap((group) =>
                group.projects.flatMap((project, projectIndex) => {
                  const tokenIds = collectReportTokenIds(
                    project.budgetByToken,
                    project.spentByToken,
                  );
                  const lines = tokenIds.length > 0 ? tokenIds : [null];
                  return lines.map((tokenId, lineIndex) => (
                    <TableRow
                      key={`${group.clientName}-${project.projectSlug}-${tokenId ?? "none"}`}
                    >
                      <TableCell className="font-medium">
                        {projectIndex === 0 && lineIndex === 0 ? group.clientName : ""}
                      </TableCell>
                      <TableCell>
                        {lineIndex === 0 && (
                          <>
                            <span className="block">{project.projectTitle}</span>
                            <span className="block text-muted-foreground">
                              @{project.projectSlug}
                            </span>
                          </>
                        )}
                      </TableCell>
                      {tokenId ? (
                        <>
                          <TableCell title={tokenId}>{tokenDisplayName(tokenId)}</TableCell>
                          <TableCell>
                            <TokenAmountCell
                              amount={getTokenAmount(project.budgetByToken, tokenId)}
                              tokenId={tokenId}
                            />
                          </TableCell>
                          <TableCell>
                            <TokenAmountCell
                              amount={getTokenAmount(project.spentByToken, tokenId)}
                              tokenId={tokenId}
                            />
                          </TableCell>
                        </>
                      ) : (
                        <TableCell colSpan={3} className="text-muted-foreground">
                          No budget or spend recorded.
                        </TableCell>
                      )}
                    </TableRow>
                  ));
                }),
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
