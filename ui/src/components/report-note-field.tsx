import { Input } from "@/components";
import { Field } from "@/components/admin-form";

const REPORT_NOTE_HELPER =
  "Optional memo for this export — e.g. “Q3 review for Acme” or “excludes pending billings”. Shown in the preview and summary CSV; not saved as report history.";

type ReportNoteFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
};

export function ReportNoteField({ id, value, onChange }: ReportNoteFieldProps) {
  return (
    <Field label="report memo (optional)" htmlFor={id} helper={REPORT_NOTE_HELPER}>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Q3 summary for board review"
        maxLength={4000}
      />
    </Field>
  );
}
