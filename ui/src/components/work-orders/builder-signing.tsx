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
  Input,
} from "@/components";
import { Field } from "@/components/admin-form";
import { Checkbox } from "@/components/ui/checkbox";
import { type ApiClient, useApiClient } from "@/lib/api";
import { myWorkOrdersQueryKey } from "@/lib/queries";
import { OpenDocumentButton } from "./open-document-button";

type MyWorkOrder = Awaited<ReturnType<ApiClient["myWorkOrders"]["get"]>>;

export function BuilderSigning({
  workOrder: wo,
  onDecline,
}: {
  workOrder: MyWorkOrder;
  onDecline: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const document = useQuery({
    queryKey: [
      ...myWorkOrdersQueryKey,
      "document",
      wo.id,
      wo.signing.documentSha256,
      wo.documentSha256,
    ],
    queryFn: () => apiClient.myWorkOrders.document({ id: wo.id }),
    retry: false,
  });
  const [name, setName] = useState(wo.contractorName ?? "");
  const [agree, setAgree] = useState(false);
  const sign = useMutation({
    mutationFn: () =>
      apiClient.myWorkOrders.sign({
        id: wo.id,
        documentSha256: document.data?.sha256 ?? "",
        name: name.trim(),
        agree: true,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: myWorkOrdersQueryKey });
      toast.success("Signed. The Agency countersigns next; you'll get the signed PDF by email.");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't sign"),
  });

  const waiting = wo.status === "offered";
  const esign = wo.signing.esign?.sent ? wo.signing.esign : null;
  const signedByBuilder = wo.signing.builder;
  const complete = signedByBuilder && wo.signing.representative;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{waiting ? `Sign Work Order ${wo.code}` : "Work order document"}</h2>
        </CardTitle>
        <CardDescription>
          {waiting && esign
            ? `${wo.agencyName} sent you this work order to sign. We emailed you a link to sign it; you can also open it from here. You'll be paid to ${wo.builder.nearAccount}.`
            : waiting
              ? `${wo.agencyName} sent you this work order to sign. Read it, then sign with your full name below. You're signed in with ${wo.builder.nearAccount}, the account you'll be paid to.`
              : complete
                ? `Signed by you on ${signedByBuilder.signedAt.slice(0, 10)} and countersigned by ${wo.signing.representative?.name} on ${wo.signing.representative?.signedAt.slice(0, 10)}.`
                : signedByBuilder
                  ? `You signed on ${signedByBuilder.signedAt.slice(0, 10)}. Waiting for ${wo.agencyName} to countersign.`
                  : "The document of this work order."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {document.isError ? (
          <p className="text-sm text-muted-foreground">The document isn't available yet.</p>
        ) : (
          <OpenDocumentButton
            pdf={document.data}
            label={document.data?.kind === "signed" ? "Open the signed document" : "Open document"}
          />
        )}
        {waiting && esign && (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            {esign.builderUrl && (
              <Button asChild>
                <a href={esign.builderUrl} target="_blank" rel="noreferrer">
                  Sign in Documenso
                </a>
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => queryClient.invalidateQueries({ queryKey: myWorkOrdersQueryKey })}
            >
              I've signed: refresh
            </Button>
            <Button variant="ghost" onClick={onDecline}>
              Decline
            </Button>
          </div>
        )}
        {waiting && !esign && document.data && (
          <form
            className="flex flex-col gap-4 border-t pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (agree && name.trim().length >= 2) sign.mutate();
            }}
          >
            <Field label="Your full name" htmlFor="sign-name" helper="Typed as your signature.">
              <Input
                id="sign-name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <label htmlFor="sign-agree" className="flex items-start gap-2 text-sm">
              <Checkbox
                id="sign-agree"
                checked={agree}
                onCheckedChange={(checked) => setAgree(checked === true)}
              />
              <span>
                I've read this work order and agree to sign it electronically. My typed name is my
                signature.
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!agree || name.trim().length < 2 || sign.isPending}>
                {sign.isPending ? "Signing…" : "Sign the work order"}
              </Button>
              <Button type="button" variant="outline" onClick={onDecline}>
                Decline
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
