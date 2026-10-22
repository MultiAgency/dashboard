import { createHash } from "node:crypto";
import type { PDFFont, PDFPage } from "pdf-lib";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib/dist/pdf-lib.esm.js";

export type SignerRecord = {
  role: "contractor" | "representative";
  name: string;
  email: string | null;
  nearAccount: string | null;
  ip: string | null;
  userAgent: string | null;
  signedAt: Date;
};

const PAGE = { width: 612, height: 792, margin: 56 };
const REPLACEMENTS: [RegExp, string][] = [
  [/[→⇒]/g, "->"],
  [/←/g, "<-"],
  [/[☑☒]/g, "[x]"],
  [/☐/g, "[ ]"],
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/[–—]/g, "-"],
  [/…/g, "..."],
];

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64"));
}

function plain(text: string): string {
  let out = text;
  for (const [pattern, value] of REPLACEMENTS) out = out.replace(pattern, value);
  return out.replace(/[^\x20-\x7e\xa0-\xff\n]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of plain(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

class Writer {
  private page: PDFPage;
  private y: number;

  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.page = doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - PAGE.margin;
  }

  text(
    value: string,
    options: { size?: number; bold?: boolean; gap?: number; muted?: boolean } = {},
  ) {
    const size = options.size ?? 10;
    const font = options.bold ? this.bold : this.font;
    for (const line of wrap(value, font, size, PAGE.width - PAGE.margin * 2)) {
      if (this.y - size < PAGE.margin) {
        this.page = this.doc.addPage([PAGE.width, PAGE.height]);
        this.y = PAGE.height - PAGE.margin;
      }
      this.page.drawText(line, {
        x: PAGE.margin,
        y: this.y - size,
        size,
        font,
        color: options.muted ? rgb(0.35, 0.35, 0.35) : rgb(0, 0, 0),
      });
      this.y -= size * 1.4;
    }
    this.y -= options.gap ?? 0;
  }

  rule() {
    this.page.drawLine({
      start: { x: PAGE.margin, y: this.y },
      end: { x: PAGE.width - PAGE.margin, y: this.y },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
    this.y -= 12;
  }
}

export async function termsPdf(input: {
  title: string;
  rows: [string, string][];
  footer: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(plain(input.title));
  doc.setCreator("MultiAgency");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const writer = new Writer(doc, font, bold);
  writer.text(input.title, { size: 16, bold: true, gap: 8 });
  for (const [label, value] of input.rows) {
    writer.text(label, { size: 9, bold: true });
    writer.text(value || "-", { size: 10, gap: 6 });
  }
  writer.rule();
  writer.text(input.footer, { size: 9, muted: true });
  return doc.save({ useObjectStreams: false });
}

const ROLE_LABEL = { contractor: "Builder (contractor)", representative: "Agency representative" };

export async function signedPdf(input: {
  original: Uint8Array;
  title: string;
  documentSha256: string;
  completedAt: Date;
  signers: SignerRecord[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(input.original);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const writer = new Writer(doc, font, bold);
  writer.text("Signature certificate", { size: 16, bold: true, gap: 4 });
  writer.text(input.title, { size: 11, gap: 8 });
  writer.text(
    `Every party signed the document above electronically in MultiAgency. The pages before this certificate are the document they signed; its SHA-256 fingerprint is:`,
    { size: 9 },
  );
  writer.text(input.documentSha256, { size: 9, bold: true, gap: 10 });
  for (const signer of input.signers) {
    writer.rule();
    writer.text(ROLE_LABEL[signer.role], { size: 11, bold: true, gap: 2 });
    writer.text(`Signed as: ${signer.name}`, { size: 10 });
    if (signer.email) writer.text(`Email: ${signer.email}`, { size: 10 });
    if (signer.nearAccount) {
      writer.text(`NEAR account (signed in with its wallet): ${signer.nearAccount}`, { size: 10 });
    }
    writer.text(`Signed at: ${signer.signedAt.toISOString().replace("T", " ").slice(0, 19)} UTC`, {
      size: 10,
    });
    if (signer.ip) writer.text(`IP address: ${signer.ip}`, { size: 9, muted: true });
    if (signer.userAgent) {
      writer.text(`Browser: ${signer.userAgent.slice(0, 160)}`, { size: 9, muted: true, gap: 4 });
    }
  }
  writer.rule();
  writer.text(
    `Completed ${input.completedAt.toISOString().replace("T", " ").slice(0, 19)} UTC. Each signer agreed to sign electronically and typed their name as their signature.`,
    { size: 9, muted: true },
  );
  return doc.save({ useObjectStreams: false });
}
