import { ArrowLeftIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { Link, type LinkProps } from "@tanstack/react-router";
import type { FormEvent, ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type TextFieldApi = {
  name: string;
  state: { value: string | undefined; meta: { errors: unknown[] } };
  handleBlur: () => void;
  handleChange: (value: string) => void;
};

export function InquiryPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl animate-fade-in flex-col gap-6">
      <PageHeader title={title} description={description} />
      {children}
    </div>
  );
}

export function InquiryForm({
  id,
  title,
  description,
  isPending,
  onSubmit,
  aside,
  children,
}: {
  id: string;
  title: string;
  description: string;
  isPending: boolean;
  onSubmit: () => void | Promise<void>;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    await onSubmit();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form id={id} noValidate onSubmit={handleSubmit}>
          <FieldGroup>{children}</FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-3">
        <div className="min-w-0 text-xs text-muted-foreground">{aside}</div>
        <Button type="submit" form={id} disabled={isPending} className="ml-auto">
          {isPending && <Spinner data-icon="inline-start" />}
          {isPending ? "Sending…" : "Send"}
        </Button>
      </CardFooter>
    </Card>
  );
}

export function InquiryTextField({
  field,
  label,
  placeholder,
  description,
  type = "text",
  multiline = false,
  disabled,
}: {
  field: TextFieldApi;
  label: string;
  placeholder?: string;
  description?: string;
  type?: "text" | "email";
  multiline?: boolean;
  disabled?: boolean;
}) {
  const error = fieldErrorMessage(field.state.meta.errors[0]);
  const errorId = `${field.name}-error`;
  const descriptionId = `${field.name}-description`;
  const describedBy =
    [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;
  const controlProps = {
    id: field.name,
    name: field.name,
    value: field.state.value ?? "",
    onBlur: field.handleBlur,
    placeholder,
    disabled,
  };
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      {multiline ? (
        <Textarea
          {...controlProps}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          rows={5}
          onChange={(e) => field.handleChange(e.target.value)}
        />
      ) : (
        <Input
          {...controlProps}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          type={type}
          onChange={(e) => field.handleChange(e.target.value)}
        />
      )}
      {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
      {error && (
        <FieldError id={errorId} role="status" aria-live="polite">
          {error}
        </FieldError>
      )}
    </Field>
  );
}

export function InquirySent({
  title,
  description,
  next,
}: {
  title: string;
  description: string;
  next: { label: string; link: LinkProps };
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl animate-fade-in flex-col gap-6">
      <Card variant="highlight">
        <CardHeader>
          <CheckCircleIcon aria-hidden className="size-5 text-muted-foreground" />
          <CardTitle>
            <h1>{title}</h1>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardFooter className="flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/">
              <ArrowLeftIcon data-icon="inline-start" aria-hidden />
              Back to home
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link {...next.link}>{next.label}</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function fieldErrorMessage(err: unknown): string | null {
  if (!err) return null;
  if (typeof err === "string") return err;
  if (typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    return typeof msg === "string" ? msg : "Invalid value";
  }
  return "Invalid value";
}
