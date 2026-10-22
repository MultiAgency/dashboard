import type { DriveFile, GooglePort } from "../../src/services/work-orders/google";

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
  email = "multiagency@project.iam.gserviceaccount.com";
  copies: { templateId: string; name: string; parentId: string; id: string }[] = [];
  filled = new Map<string, Record<string, string>>();
  templateKeys = new Set<string>();
  pdfs = new Map<string, { file: DriveFile; folderId: string; bytes: Uint8Array }>();
  failDownloads = new Set<string>();

  constructor(templateKeys: string[]) {
    this.templateKeys = new Set(templateKeys);
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
    return Object.fromEntries(
      Object.keys(values).map((k) => [k, this.templateKeys.has(k) ? 1 : 0]),
    );
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

  async download(id: string) {
    if (this.failDownloads.has(id)) throw new Error("Drive download failed");
    const pdf = this.pdfs.get(id);
    if (!pdf) throw new Error("not found");
    return pdf.bytes;
  }
}
