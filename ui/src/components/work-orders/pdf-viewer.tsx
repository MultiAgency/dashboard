import { useEffect, useMemo } from "react";
import { Button } from "@/components";

export type WorkOrderPdf = {
  kind: "offered" | "signed";
  fileName: string;
  sha256: string;
  pdfBase64: string;
  driveUrl: string | null;
};

function blobOf(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "application/pdf" });
}

export function PdfViewer({
  document: doc,
  height = 640,
}: {
  document: WorkOrderPdf;
  height?: number;
}) {
  const url = useMemo(() => URL.createObjectURL(blobOf(doc.pdfBase64)), [doc.pdfBase64]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="flex flex-col gap-2">
      <iframe
        title={doc.fileName}
        src={url}
        className="w-full border bg-background"
        style={{ height }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" asChild>
          <a href={url} download={doc.fileName}>
            Download {doc.kind === "signed" ? "the signed PDF" : "the PDF"}
          </a>
        </Button>
        {doc.driveUrl && (
          <Button size="sm" variant="ghost" asChild>
            <a href={doc.driveUrl} target="_blank" rel="noreferrer">
              Open in Google Drive
            </a>
          </Button>
        )}
        <span className="font-mono text-xs break-all text-muted-foreground">
          SHA-256 {doc.sha256.slice(0, 16)}…
        </span>
      </div>
    </div>
  );
}
