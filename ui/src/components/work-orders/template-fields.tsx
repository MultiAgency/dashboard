import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { ChoiceSelect, Loading } from "@/components/admin-form";
import { type ApiClient, useApiClient } from "@/lib/api";
import { openPendingTab, type PendingTab } from "@/lib/pending-tab";
import { TemplateSetup } from "./template-setup";

type Integration = Awaited<ReturnType<ApiClient["workOrders"]["integration"]>>;
type Scan = Awaited<ReturnType<ApiClient["workOrders"]["scanTemplate"]>>;
type Mapping = Integration["google"]["fieldMap"][string];

type Choice = { choice: string; value: string };

function choiceOf(tag: Scan["tags"][number]): Choice {
  const m = tag.mapping;
  if (!m) return { choice: tag.known ? "auto" : "none", value: "" };
  if (m.kind === "field") return { choice: `field:${m.field}`, value: "" };
  if (m.kind === "text") return { choice: "text", value: m.value };
  return { choice: "ask", value: m.label };
}

function mappingOf(tag: string, c: Choice): Mapping | null {
  if (c.choice.startsWith("field:")) {
    const field = c.choice.slice("field:".length);
    return field === tag ? null : { kind: "field", field };
  }
  if (c.choice === "text") return { kind: "text", value: c.value };
  if (c.choice === "ask") return { kind: "ask", label: c.value.trim() || tag };
  return null;
}

export function fieldOptions(known: Integration["google"]["knownFields"]) {
  return known.map((f) => ({ value: `field:${f.key}`, label: f.label }));
}

export function TemplateFields({
  data,
  onUpdate,
}: {
  data: Integration;
  onUpdate: (data: Integration) => void;
}) {
  const apiClient = useApiClient();
  const google = data.google;
  const [setupOpen, setSetupOpen] = useState(false);
  const scan = useQuery({
    queryKey: ["admin", "work-order-template-scan", google.templateUrl],
    queryFn: () => apiClient.workOrders.scanTemplate({ detect: false }),
    retry: false,
    enabled: !!google.templateUrl,
  });
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  useEffect(() => {
    if (!scan.data) return;
    setChoices(Object.fromEntries(scan.data.tags.map((t) => [t.tag, choiceOf(t)])));
  }, [scan.data]);

  const save = useMutation({
    mutationFn: () => {
      const map: Record<string, Mapping> = {};
      for (const [tag, c] of Object.entries(choices)) {
        const mapping = mappingOf(tag, c);
        if (mapping) map[tag] = mapping;
      }
      return apiClient.workOrders.saveTemplateFields({ map });
    },
    onSuccess: (next) => {
      onUpdate(next);
      void scan.refetch();
      toast.success("Template fields saved");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't save the fields"),
  });
  const preview = useMutation({
    mutationFn: (_tab: PendingTab) => apiClient.workOrders.previewTemplate({}),
    onSuccess: ({ url }, tab) => {
      tab.go(url);
      toast.success("A preview with sample data is in your documents folder");
    },
    onError: (err: Error, tab) => {
      tab.close();
      toast.error(err.message || "Couldn't make a preview");
    },
  });

  const labelOf = (key: string) => google.knownFields.find((f) => f.key === key)?.label ?? key;
  const options = [
    ...fieldOptions(google.knownFields),
    { value: "text", label: "Fixed text…" },
    { value: "ask", label: "Ask when creating the work order" },
  ];

  return (
    <section className="flex flex-col gap-3 border-t pt-4" aria-labelledby="wo-template-fields">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="wo-template-fields" className="text-sm font-medium">
          Template fields
        </h4>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setSetupOpen(true)}>
            Set up fields
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!google.documentsFolderUrl || preview.isPending}
            onClick={() => preview.mutate(openPendingTab("Making a preview…"))}
          >
            {preview.isPending ? "Making a preview…" : "Preview"}
          </Button>
        </div>
      </div>
      {scan.isLoading && <Loading label="Reading the template" />}
      {scan.isError && <AdminError error={scan.error} />}
      {scan.data && (
        <>
          {scan.data.missing.length > 0 && (
            <Alert>
              <AlertTitle>Missing from the template</AlertTitle>
              <AlertDescription>
                {scan.data.missing.map(labelOf).join(", ")}. Use Set up fields to mark where they
                go.
              </AlertDescription>
            </Alert>
          )}
          {scan.data.tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No {"{{tags}}"} in {scan.data.templateName || "the template"} yet. Set up fields finds
              the blanks and placeholders for you.
            </p>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Tag</TableHead>
                    <TableHead scope="col">Fills with</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scan.data.tags.map((t) => {
                    const c = choices[t.tag] ?? choiceOf(t);
                    const setChoice = (next: Partial<Choice>) =>
                      setChoices((current) => ({ ...current, [t.tag]: { ...c, ...next } }));
                    return (
                      <TableRow key={t.tag}>
                        <TableCell className="align-top font-mono text-xs">
                          {`{{${t.tag}}}`}
                          {t.count > 1 && (
                            <span className="text-muted-foreground"> ×{t.count}</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {c.choice === "auto" ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">✓ {labelOf(t.tag)}</Badge>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setChoice({ choice: `field:${t.tag}` })}
                              >
                                Change
                              </Button>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-2">
                              <ChoiceSelect
                                ariaLabel={`What fills {{${t.tag}}}`}
                                size="sm"
                                value={c.choice === "none" ? "" : c.choice}
                                emptyLabel="Not filled"
                                onValueChange={(value) =>
                                  setChoice({
                                    choice: value || "none",
                                    value: value === "ask" && !c.value ? t.tag : c.value,
                                  })
                                }
                                options={options}
                              />
                              {(c.choice === "text" || c.choice === "ask") && (
                                <Input
                                  aria-label={
                                    c.choice === "text" ? "Fixed text" : "Question on the form"
                                  }
                                  placeholder={
                                    c.choice === "text" ? "Fixed text" : "Label on the form"
                                  }
                                  value={c.value}
                                  onChange={(e) => setChoice({ value: e.target.value })}
                                />
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <Button type="submit" size="sm" className="self-start" disabled={save.isPending}>
                Save fields
              </Button>
            </form>
          )}
        </>
      )}
      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          {setupOpen && (
            <TemplateSetup
              knownFields={google.knownFields}
              aiAvailable={google.aiFieldsAvailable}
              onDone={(next) => {
                onUpdate(next);
                setSetupOpen(false);
                void scan.refetch();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
