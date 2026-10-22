import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components";

export type WorkOrderPdf = {
  kind: "offered" | "signed";
  fileName: string;
  sha256: string;
  pdfBase64: string;
  driveUrl: string | null;
};

function blobUrlOf(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

export function OpenDocumentButton({
  href,
  pdf,
  load,
  label = "Open document",
  size = "sm",
  variant = "outline",
}: {
  href?: string | null;
  pdf?: WorkOrderPdf | null;
  load?: () => Promise<WorkOrderPdf>;
  label?: string;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "ghost";
}) {
  const [opening, setOpening] = useState(false);

  if (href) {
    return (
      <Button size={size} variant={variant} asChild>
        <a href={href} target="_blank" rel="noreferrer">
          {label}
        </a>
      </Button>
    );
  }

  const open = async () => {
    const tab = window.open("", "_blank");
    try {
      setOpening(true);
      const doc = pdf ?? (await load?.());
      if (!doc) throw new Error("The document isn't available yet");
      const target = doc.driveUrl ?? blobUrlOf(doc.pdfBase64);
      if (tab) tab.location.href = target;
      else window.location.href = target;
    } catch (error) {
      tab?.close();
      toast.error(error instanceof Error ? error.message : "Couldn't open the document");
    } finally {
      setOpening(false);
    }
  };

  return (
    <Button size={size} variant={variant} disabled={opening || (!pdf && !load)} onClick={open}>
      {opening ? "Opening…" : label}
    </Button>
  );
}
