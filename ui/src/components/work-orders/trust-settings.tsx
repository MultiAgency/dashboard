import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldGroup,
  Input,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { ChoiceSelect, Field, Loading } from "@/components/admin-form";
import { type ApiClient, useApiClient } from "@/lib/api";
import { workOrderTrustQueryOptions } from "@/lib/queries";

type TrustSettings = Awaited<ReturnType<ApiClient["workOrders"]["trustSettings"]>>;
type Mode = TrustSettings["mode"];

const MODES: { value: Mode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "suggest", label: "Suggest only" },
  { value: "auto", label: "Automatic" },
];

const isMode = (value: string): value is Mode => MODES.some((m) => m.value === value);

export function WorkOrderTrustSettings() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const query = useQuery(workOrderTrustQueryOptions(apiClient));
  const [form, setForm] = useState<{ mode: Mode; vetoHours: string } | null>(null);

  const save = useMutation({
    mutationFn: (values: { mode: Mode; vetoHours: number }) =>
      apiClient.workOrders.saveTrustSettings(values),
    onSuccess: (data) => {
      queryClient.setQueryData(workOrderTrustQueryOptions(apiClient).queryKey, data);
      setForm(null);
      toast.success("Approval settings saved");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't save"),
  });

  if (query.isLoading) return <Loading label="Loading approval settings" />;
  if (query.isError || !query.data) return <AdminError error={query.error} />;
  const values = form ?? { mode: query.data.mode, vetoHours: String(query.data.vetoHours) };
  const hours = Number(values.vetoHours);
  const validHours = Number.isInteger(hours) && hours >= 1 && hours <= 168;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Automatic approval for trusted builders</h2>
        </CardTitle>
        <CardDescription>
          Builders with a clean payment history need fewer manual steps. New builders always wait
          for you. Established builders (2 clean paid periods) are approved after a window you can
          stop. Trusted builders (4 clean periods over 60 days, no flagged work) are approved and
          paid as soon as they submit.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (validHours) save.mutate({ mode: values.mode, vetoHours: hours });
          }}
        >
          <FieldGroup>
            <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
              <Field
                label="Mode"
                htmlFor="trust-mode"
                helper={
                  values.mode === "auto"
                    ? "Requests are approved automatically when nothing blocks them."
                    : values.mode === "suggest"
                      ? "Each request shows what would happen; you still approve it."
                      : "Every request waits for you, without the AI check."
                }
              >
                <ChoiceSelect
                  id="trust-mode"
                  value={values.mode}
                  onValueChange={(next) => {
                    if (isMode(next)) setForm({ ...values, mode: next });
                  }}
                  options={MODES}
                  disabled={save.isPending}
                />
              </Field>
              <Field
                label="Hours to stop an approval"
                htmlFor="trust-veto-hours"
                helper="How long an established builder's request waits before it's approved."
              >
                <Input
                  id="trust-veto-hours"
                  type="number"
                  min={1}
                  max={168}
                  value={values.vetoHours}
                  aria-invalid={validHours ? undefined : true}
                  onChange={(e) => setForm({ ...values, vetoHours: e.target.value })}
                  disabled={save.isPending}
                />
              </Field>
            </div>
          </FieldGroup>
          <p className="text-sm text-muted-foreground">
            Any blocker sends a request to you: no authorized evidence, an amount above the cap for
            the dates or the remaining budget, overlapping dates, unapproved pull requests, or a
            payee account that is new or unconfirmed. The AI check only compares the report with the
            evidence. It can slow an approval down, never speed it up.
          </p>
          <Button
            type="submit"
            size="sm"
            className="self-start"
            disabled={save.isPending || !validHours}
          >
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
