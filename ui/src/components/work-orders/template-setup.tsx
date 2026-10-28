import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { ChoiceSelect, Loading } from "@/components/admin-form";
import { type ApiClient, useApiClient } from "@/lib/api";
import { openPendingTab, type PendingTab } from "@/lib/pending-tab";

type Integration = Awaited<ReturnType<ApiClient["workOrders"]["integration"]>>;
type Scan = Awaited<ReturnType<ApiClient["workOrders"]["scanTemplate"]>>;
type Spot = Scan["spots"][number];

type Row = {
  key: string;
  text: string;
  target: string;
  label: string;
  source: Spot["source"] | "manual";
  count: number;
  contexts: string[];
  choice: string;
  value: string;
  occurrence: string;
};

const ALL = "all";

function contextsIn(text: string, needle: string): string[] {
  const out: string[] = [];
  if (!needle) return out;
  let at = text.indexOf(needle);
  while (at >= 0) {
    out.push(
      text
        .slice(Math.max(0, at - 40), at + needle.length + 40)
        .replace(/\s+/g, " ")
        .trim(),
    );
    at = text.indexOf(needle, at + needle.length);
  }
  return out;
}

function rowOf(spot: Spot, index: number): Row {
  const s = spot.suggestion;
  return {
    key: `${spot.source}-${index}`,
    text: spot.text,
    target: spot.target,
    label: spot.label,
    source: spot.source,
    count: spot.count,
    contexts: spot.contexts,
    choice: s.kind === "field" ? `field:${s.field}` : s.kind,
    value: s.kind === "text" ? spot.target : spot.label,
    occurrence: ALL,
  };
}

function Context({ context, target }: { context: string; target: string }) {
  const at = context.indexOf(target);
  if (at < 0) return <span className="text-muted-foreground">{context}</span>;
  return (
    <span className="text-muted-foreground">
      {context.slice(0, at)}
      <span className="rounded-sm bg-muted px-0.5 font-medium text-foreground">{target}</span>
      {context.slice(at + target.length)}
    </span>
  );
}

export function TemplateSetup({
  knownFields,
  aiAvailable,
  onDone,
}: {
  knownFields: Integration["google"]["knownFields"];
  aiAvailable: boolean;
  onDone: (next: Integration) => void;
}) {
  const apiClient = useApiClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [paste, setPaste] = useState("");
  const scan = useQuery({
    queryKey: ["admin", "work-order-template-setup"],
    queryFn: () => apiClient.workOrders.scanTemplate({ detect: true }),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  });
  useEffect(() => {
    if (scan.data) setRows(scan.data.spots.map(rowOf));
  }, [scan.data]);

  const apply = useMutation({
    mutationFn: (_tab: PendingTab) =>
      apiClient.workOrders.applyTemplateFields({
        spots: rows.map((row) => ({
          text: row.text,
          target: row.target,
          occurrence: row.occurrence === ALL ? null : Number(row.occurrence),
          mapping: row.choice.startsWith("field:")
            ? { kind: "field" as const, field: row.choice.slice("field:".length) }
            : row.choice === "text"
              ? { kind: "text" as const, value: row.value }
              : row.choice === "ask"
                ? { kind: "ask" as const, label: row.value.trim() || row.label }
                : { kind: "ignore" as const },
        })),
      }),
    onSuccess: (next, tab) => {
      toast.success("A tagged copy of your template is ready and selected");
      tab.go(next.url);
      onDone(next);
    },
    onError: (err: Error, tab) => {
      tab.close();
      toast.error(err.message || "Couldn't set up the fields");
    },
  });

  const text = scan.data?.text ?? "";
  const needle = paste.trim();
  const pasted = needle ? contextsIn(text, needle) : [];
  const update = (key: string, next: Partial<Row>) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...next } : r)));
  const options = [
    ...knownFields.map((f) => ({ value: `field:${f.key}`, label: f.label })),
    { value: "text", label: "Fixed text…" },
    { value: "ask", label: "Ask when creating the work order" },
    { value: "ignore", label: "Ignore" },
  ];
  const active = rows.filter((r) => r.choice !== "ignore");

  return (
    <>
      <DialogHeader>
        <DialogTitle>Set up the template's fields</DialogTitle>
        <DialogDescription>
          MultiAgency found the spots to fill in. Pick what goes in each: it makes a copy of your
          template with tags in those spots and uses the copy from now on. Your original isn't
          changed.
        </DialogDescription>
      </DialogHeader>
      {scan.isLoading && (
        <Loading
          label={
            aiAvailable
              ? "Reading the template and asking AI for suggestions"
              : "Reading the template"
          }
        />
      )}
      {scan.isError && <AdminError error={scan.error} />}
      {scan.data && (
        <div className="flex flex-col gap-4">
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No blanks or placeholders were found. Add the spots by pasting their text below.
            </p>
          )}
          {rows.map((row) => (
            <div key={row.key} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{row.label}</span>
                <Badge variant={row.source === "ai" ? "secondary" : "outline"}>
                  {row.source === "ai" ? "AI" : row.source === "manual" ? "Added" : "Pattern"}
                </Badge>
                {row.count > 1 && (
                  <span className="text-xs text-muted-foreground">{row.count} places</span>
                )}
              </div>
              <Context context={row.contexts[0] ?? row.text} target={row.target} />
              <div className="grid gap-2 sm:grid-cols-2">
                <ChoiceSelect
                  ariaLabel={`What fills ${row.label}`}
                  size="sm"
                  value={row.choice}
                  onValueChange={(choice) => update(row.key, { choice })}
                  options={options}
                />
                {row.count > 1 && (
                  <ChoiceSelect
                    ariaLabel="Which places"
                    size="sm"
                    value={row.occurrence}
                    onValueChange={(occurrence) => update(row.key, { occurrence })}
                    options={[
                      { value: ALL, label: `All ${row.count} places` },
                      ...row.contexts.map((context, i) => ({
                        value: String(i),
                        label: `Only #${i + 1}: ${context.slice(0, 60)}`,
                      })),
                    ]}
                  />
                )}
                {(row.choice === "text" || row.choice === "ask") && (
                  <Input
                    aria-label={row.choice === "text" ? "Fixed text" : "Label on the form"}
                    placeholder={row.choice === "text" ? "Fixed text" : "Label on the form"}
                    value={row.value}
                    onChange={(e) => update(row.key, { value: e.target.value })}
                  />
                )}
              </div>
            </div>
          ))}
          <div className="flex flex-col gap-2 border-t pt-4">
            <span className="text-sm font-medium">Add a field</span>
            <span className="text-sm text-muted-foreground">
              Paste the exact text from the document that should be replaced, like a sample name or
              amount.
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="Text from the template"
                className="max-w-md"
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pasted.length === 0}
                onClick={() => {
                  const target = needle;
                  setRows((current) => [
                    ...current,
                    {
                      key: `manual-${current.length}-${target}`,
                      text: target,
                      target,
                      label: target,
                      source: "manual",
                      count: pasted.length,
                      contexts: pasted.slice(0, 5),
                      choice: "ask",
                      value: "",
                      occurrence: ALL,
                    },
                  ]);
                  setPaste("");
                }}
              >
                Add
              </Button>
              {needle && (
                <span className="text-xs text-muted-foreground">
                  {pasted.length === 0
                    ? "Not found in the template"
                    : `Found in ${pasted.length} ${pasted.length === 1 ? "place" : "places"}`}
                </span>
              )}
            </div>
          </div>
          {active.length === 0 && rows.length > 0 && (
            <Alert>
              <AlertDescription>Every spot is set to Ignore.</AlertDescription>
            </Alert>
          )}
        </div>
      )}
      <DialogFooter>
        <Button
          disabled={!scan.data || active.length === 0 || apply.isPending}
          onClick={() => apply.mutate(openPendingTab("Making the tagged copy…"))}
        >
          {apply.isPending ? "Making the tagged copy…" : "Apply to a copy"}
        </Button>
      </DialogFooter>
    </>
  );
}
