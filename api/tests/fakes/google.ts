import type { DriveFile, GoogleDoc, GooglePort } from "../../src/services/work-orders/google";

type FakeDoc = { title: string; segments: { segmentId: string | null; text: string }[] };

export function minimalPdf(lines: string[]): Uint8Array {
  const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = [
    "BT",
    "/F1 11 Tf",
    "14 TL",
    "50 780 Td",
    ...lines.map((l) => `(${esc(l)}) '`),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

export class FakeGoogle implements GooglePort {
  kind: "service_account" | "oauth" = "service_account";
  email = "multiagency@project.iam.gserviceaccount.com";
  docs = new Map<string, FakeDoc>();
  edits: { documentId: string; requests: unknown[] }[] = [];
  copies: { templateId: string; name: string; parentId: string; id: string }[] = [];
  filled = new Map<string, Record<string, string>>();
  templateKeys = new Set<string>();
  pdfs = new Map<string, { file: DriveFile; folderId: string; bytes: Uint8Array }>();
  failDownloads = new Set<string>();

  constructor(templateKeys: string[]) {
    this.templateKeys = new Set(templateKeys);
  }

  setDoc(id: string, body: string, extra: { segmentId: string; text: string }[] = []) {
    this.docs.set(id, {
      title: id,
      segments: [{ segmentId: null, text: body }, ...extra],
    });
    return this;
  }

  textOf(id: string): string {
    return (this.docs.get(id)?.segments ?? []).map((s) => s.text).join("\n");
  }

  async read(documentId: string): Promise<GoogleDoc> {
    const doc = this.docs.get(documentId);
    return {
      id: documentId,
      title: doc?.title ?? documentId,
      runs: (doc?.segments ?? []).map((s) => ({
        segmentId: s.segmentId,
        start: s.segmentId ? 0 : 1,
        text: s.text,
      })),
    };
  }

  async edit(documentId: string, requests: unknown[]) {
    this.edits.push({ documentId, requests });
    const doc = this.docs.get(documentId);
    if (!doc) return;
    for (const raw of requests as Record<string, Record<string, never>>[]) {
      const request = raw as {
        deleteContentRange?: {
          range: { startIndex: number; endIndex: number; segmentId?: string };
        };
        insertText?: { location: { index: number; segmentId?: string }; text: string };
        replaceAllText?: { containsText: { text: string }; replaceText: string };
      };
      const segmentOf = (id?: string) => doc.segments.find((s) => s.segmentId === (id ?? null));
      if (request.deleteContentRange) {
        const { startIndex, endIndex, segmentId } = request.deleteContentRange.range;
        const segment = segmentOf(segmentId);
        const base = segmentId ? 0 : 1;
        if (segment) {
          segment.text =
            segment.text.slice(0, startIndex - base) + segment.text.slice(endIndex - base);
        }
      }
      if (request.insertText) {
        const { index, segmentId } = request.insertText.location;
        const segment = segmentOf(segmentId);
        const base = segmentId ? 0 : 1;
        if (segment) {
          segment.text =
            segment.text.slice(0, index - base) +
            request.insertText.text +
            segment.text.slice(index - base);
        }
      }
      if (request.replaceAllText) {
        for (const segment of doc.segments) {
          segment.text = segment.text
            .split(request.replaceAllText.containsText.text)
            .join(request.replaceAllText.replaceText);
        }
      }
    }
  }

  async file(id: string): Promise<DriveFile> {
    return {
      id,
      name: id,
      mimeType: "application/vnd.google-apps.document",
      webViewLink: null,
      createdTime: null,
      driveId: "shared",
    };
  }

  async copy(templateId: string, input: { name: string; parentId: string }): Promise<DriveFile> {
    const id = `doc-${this.copies.length + 1}`;
    this.copies.push({ templateId, ...input, id });
    const source = this.docs.get(templateId);
    if (source) {
      this.docs.set(id, {
        title: input.name,
        segments: source.segments.map((segment) => ({ ...segment })),
      });
    }
    return {
      id,
      name: input.name,
      mimeType: "application/vnd.google-apps.document",
      webViewLink: `https://docs.google.com/document/d/${id}/edit`,
      createdTime: null,
      driveId: "shared",
    };
  }

  async fill(documentId: string, values: Record<string, string>) {
    this.filled.set(documentId, values);
    const doc = this.docs.get(documentId);
    if (!doc) {
      return Object.fromEntries(
        Object.keys(values).map((k) => [k, this.templateKeys.has(k) ? 1 : 0]),
      );
    }
    const counts: Record<string, number> = {};
    for (const [key, value] of Object.entries(values)) {
      counts[key] = 0;
      for (const segment of doc.segments) {
        const parts = segment.text.split(`{{${key}}}`);
        counts[key] += parts.length - 1;
        segment.text = parts.join(value);
      }
    }
    return counts;
  }

  addPdf(folderId: string, id: string, lines: string[], createdTime = "2026-08-30T10:00:00.000Z") {
    this.pdfs.set(id, {
      folderId,
      bytes: minimalPdf(lines),
      file: {
        id,
        name: `${id}.pdf`,
        mimeType: "application/pdf",
        webViewLink: `https://drive.google.com/file/d/${id}/view`,
        createdTime,
        driveId: "shared",
      },
    });
  }

  async listPdfs(folderId: string) {
    return [...this.pdfs.values()].filter((p) => p.folderId === folderId).map((p) => p.file);
  }

  exported = new Map<string, Uint8Array>();
  uploads: { folderId: string; name: string; bytes: Uint8Array; id: string }[] = [];

  async exportPdf(documentId: string) {
    const values = this.filled.get(documentId) ?? {};
    const pdf = minimalPdf([
      `Work Order ${values.work_order_id ?? documentId}`,
      ...Object.entries(values).map(([k, v]) => `${k}: ${v}`),
    ]);
    this.exported.set(documentId, pdf);
    return pdf;
  }

  async upload(input: {
    folderId: string;
    name: string;
    bytes: Uint8Array;
    mimeType: string;
    convertTo?: string;
  }) {
    const id = `upload-${this.uploads.length + 1}`;
    this.uploads.push({ ...input, id });
    this.pdfs.set(id, {
      folderId: input.folderId,
      bytes: new Uint8Array(input.bytes),
      file: {
        id,
        name: input.name,
        mimeType: "application/pdf",
        webViewLink: `https://drive.google.com/file/d/${id}/view`,
        createdTime: null,
        driveId: "shared",
      },
    });
    return {
      id,
      name: input.name,
      mimeType: input.mimeType,
      webViewLink: `https://drive.google.com/file/d/${id}/view`,
      createdTime: null,
      driveId: "shared",
    };
  }

  failUploads = 0;

  async uploadPdf(folderId: string, name: string, bytes: Uint8Array) {
    if (this.failUploads > 0) {
      this.failUploads -= 1;
      throw new Error("Drive upload failed");
    }
    return this.upload({ folderId, name, bytes, mimeType: "application/pdf" });
  }

  async download(id: string) {
    if (this.failDownloads.has(id)) throw new Error("Drive download failed");
    const pdf = this.pdfs.get(id);
    if (!pdf) throw new Error("not found");
    return pdf.bytes;
  }
}
