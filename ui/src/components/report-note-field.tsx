import { Input } from "@/components";
import { Field } from "@/components/admin-form";

const REPORT_NOTE_HELPER = "Saved with the report, and shown in the preview and summary CSV.";

type ReportNoteFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
};

export function ReportNoteField({ id, value, onChange }: ReportNoteFieldProps) {
  return (
    <Field label="Memo" htmlFor={id} helper={REPORT_NOTE_HELPER}>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional, e.g. Q3 summary for board review"
        maxLength={4000}
      />
    </Field>
  );
}
