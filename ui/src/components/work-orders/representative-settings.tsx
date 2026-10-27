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
import { Field, Loading } from "@/components/admin-form";
import { useApiClient } from "@/lib/api";
import { workOrderRepresentativeQueryOptions } from "@/lib/queries";
import { isPlaceholderEmail } from "@/lib/representative";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function WorkOrderRepresentativeSettings() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const query = useQuery(workOrderRepresentativeQueryOptions(apiClient));
  const [form, setForm] = useState<{ name: string; email: string } | null>(null);

  const save = useMutation({
    mutationFn: (values: { name: string | null; email: string | null }) =>
      apiClient.workOrders.saveRepresentativeDefaults(values),
    onSuccess: (data) => {
      queryClient.setQueryData(workOrderRepresentativeQueryOptions(apiClient).queryKey, data);
      setForm(null);
      toast.success("Default representative saved");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't save"),
  });

  if (query.isLoading) return <Loading label="Loading the default representative" />;
  if (query.isError || !query.data) return <AdminError error={query.error} />;
  const values = form ?? { name: query.data.name ?? "", email: query.data.email ?? "" };
  const email = values.email.trim();
  const badEmail = email !== "" && !EMAIL.test(email);
  const placeholder = email !== "" && isPlaceholderEmail(email);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Default representative</h2>
        </CardTitle>
        <CardDescription>
          Who signs work orders for your Agency. New work orders start with these; you can change
          them on each one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!badEmail) {
              save.mutate({ name: values.name.trim() || null, email: email || null });
            }
          }}
        >
          <FieldGroup>
            <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
              <Field
                label="Default representative name"
                htmlFor="rep-default-name"
                helper="Printed on the document."
              >
                <Input
                  id="rep-default-name"
                  value={values.name}
                  onChange={(e) => setForm({ ...values, name: e.target.value })}
                  disabled={save.isPending}
                />
              </Field>
              <Field
                label="Default representative email"
                htmlFor="rep-default-email"
                helper={
                  placeholder
                    ? "This looks like a wallet placeholder address: emails sent to it are lost."
                    : "Agency emails (payout requested, signed, renewed) go only to this address."
                }
              >
                <Input
                  id="rep-default-email"
                  type="email"
                  value={values.email}
                  aria-invalid={badEmail || placeholder ? true : undefined}
                  onChange={(e) => setForm({ ...values, email: e.target.value })}
                  disabled={save.isPending}
                />
              </Field>
            </div>
          </FieldGroup>
          <Button
            type="submit"
            size="sm"
            className="self-start"
            disabled={save.isPending || badEmail}
          >
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
