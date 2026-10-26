export const BRAND = {
  name: "MultiAgency",
  site: "https://multiagency.ai",
  logo: "https://multiagency.ai/android-chrome-192x192.png",
  ink: "#0a0a0a",
  accent: "#ffff33",
  muted: "#71717a",
  line: "#e4e4e7",
  page: "#f4f4f5",
  panel: "#fafafa",
};

const REPORT_LIMIT = 6000;

export type EmailContent = {
  preheader: string;
  eyebrow: string;
  heading: string;
  greeting: string;
  paragraphs: string[];
  details?: [string, string][];
  list?: { title: string | null; items: string[] };
  action?: { label: string; url: string } | null;
  secondary?: { label: string; url: string }[];
  block?: { title: string; body: string } | null;
  footnote?: string | null;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g;

function linkify(text: string): string {
  return escapeHtml(text).replace(
    URL_PATTERN,
    (url) => `<a href="${url}" style="color:${BRAND.ink};text-decoration:underline">${url}</a>`,
  );
}

function clip(body: string): string {
  return body.length > REPORT_LIMIT ? `${body.slice(0, REPORT_LIMIT).trimEnd()}\n…` : body;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${BRAND.ink}">${linkify(text)}</p>`;
}

function detailsTable(rows: [string, string][]): string {
  const cells = rows
    .map(
      ([label, value], index) =>
        `<tr><td style="padding:10px 14px;font-size:13px;color:${BRAND.muted};white-space:nowrap;vertical-align:top;${index ? `border-top:1px solid ${BRAND.line};` : ""}">${escapeHtml(label)}</td><td style="padding:10px 14px;font-size:14px;font-weight:600;color:${BRAND.ink};text-align:right;word-break:break-word;${index ? `border-top:1px solid ${BRAND.line};` : ""}">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid ${BRAND.line};border-radius:10px;margin:4px 0 24px">${cells}</table>`;
}

function listBlock(list: NonNullable<EmailContent["list"]>): string {
  const title = list.title
    ? `<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:${BRAND.ink}">${escapeHtml(list.title)}</p>`
    : "";
  const items = list.items
    .map(
      (item) =>
        `<tr><td style="width:18px;vertical-align:top;padding:2px 0;font-size:15px;line-height:22px;color:${BRAND.ink}">•</td><td style="padding:2px 0;font-size:14px;line-height:22px;color:${BRAND.ink}">${linkify(item)}</td></tr>`,
    )
    .join("");
  return `${title}<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px">${items}</table>`;
}

function button(action: NonNullable<EmailContent["action"]>): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 12px"><tr><td style="border-radius:8px;background:${BRAND.ink}"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:15px;font-weight:600;color:${BRAND.accent};text-decoration:none;border-radius:8px">${escapeHtml(action.label)} &rarr;</a></td></tr></table><p style="margin:0 0 24px;font-size:12px;line-height:18px;color:${BRAND.muted}">Button not working? Open this link:<br><a href="${escapeHtml(action.url)}" style="color:${BRAND.muted};word-break:break-all">${escapeHtml(action.url)}</a></p>`;
}

function secondaryLinks(links: NonNullable<EmailContent["secondary"]>): string {
  if (links.length === 0) return "";
  const items = links
    .map(
      (link) =>
        `<a href="${escapeHtml(link.url)}" style="color:${BRAND.ink};font-size:14px;font-weight:600;text-decoration:underline">${escapeHtml(link.label)}</a>`,
    )
    .join(`<span style="color:${BRAND.line}">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`);
  return `<p style="margin:0 0 24px">${items}</p>`;
}

function reportBlock(block: NonNullable<EmailContent["block"]>): string {
  return `<p style="margin:8px 0 8px;font-size:13px;font-weight:600;color:${BRAND.ink}">${escapeHtml(block.title)}</p><div style="background:${BRAND.panel};border:1px solid ${BRAND.line};border-radius:10px;padding:14px 16px;margin:0 0 24px;font-family:${MONO};font-size:12px;line-height:19px;color:${BRAND.ink};white-space:pre-wrap;word-break:break-word">${linkify(clip(block.body))}</div>`;
}

export function renderEmail(content: EmailContent, agency: string): { html: string; text: string } {
  const body = [
    `<p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.muted}">${escapeHtml(content.eyebrow)}</p>`,
    `<h1 style="margin:0 0 20px;font-size:22px;line-height:30px;font-weight:700;color:${BRAND.ink}">${escapeHtml(content.heading)}</h1>`,
    paragraph(content.greeting),
    ...content.paragraphs.map(paragraph),
    content.details?.length ? detailsTable(content.details) : "",
    content.list?.items.length ? listBlock(content.list) : "",
    content.action ? button(content.action) : "",
    content.secondary ? secondaryLinks(content.secondary) : "",
    content.block?.body ? reportBlock(content.block) : "",
    content.footnote
      ? `<p style="margin:0;font-size:13px;line-height:20px;color:${BRAND.muted}">${linkify(content.footnote)}</p>`
      : "",
  ].join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(content.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};font-family:${FONT};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page}">
<tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="background:${BRAND.ink};border-radius:14px 14px 0 0;padding:18px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle"><a href="${BRAND.site}" style="text-decoration:none"><img src="${BRAND.logo}" width="28" height="28" alt="" style="display:inline-block;vertical-align:middle;border:0"><span style="display:inline-block;vertical-align:middle;margin-left:10px;font-size:16px;font-weight:700;color:#ffffff;letter-spacing:-0.01em">${BRAND.name}</span></a></td>
<td align="right" style="vertical-align:middle;font-size:13px;color:#a1a1aa">${escapeHtml(agency)}</td>
</tr></table>
</td></tr>
<tr><td style="background:${BRAND.accent};height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>
<tr><td style="background:#ffffff;padding:32px 28px 12px;border-left:1px solid ${BRAND.line};border-right:1px solid ${BRAND.line}">${body}</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${BRAND.line};border-top:0;border-radius:0 0 14px 14px;padding:0 28px 24px"></td></tr>
<tr><td style="padding:20px 28px 0;font-size:12px;line-height:18px;color:${BRAND.muted};text-align:center">Sent by ${escapeHtml(agency)} via <a href="${BRAND.site}" style="color:${BRAND.muted}">${BRAND.name}</a>, where agencies run work orders and pay builders.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    content.heading,
    "",
    content.greeting,
    "",
    ...content.paragraphs.flatMap((p) => [p, ""]),
    ...(content.details?.length
      ? [...content.details.map(([label, value]) => `${label}: ${value}`), ""]
      : []),
    ...(content.list?.items.length
      ? [
          ...(content.list.title ? [content.list.title] : []),
          ...content.list.items.map((item) => `- ${item}`),
          "",
        ]
      : []),
    ...(content.action ? [`${content.action.label}: ${content.action.url}`, ""] : []),
    ...(content.secondary ?? []).map((link) => `${link.label}: ${link.url}`),
    ...(content.secondary?.length ? [""] : []),
    ...(content.block?.body
      ? [`--- ${content.block.title} ---`, clip(content.block.body), ""]
      : []),
    ...(content.footnote ? [content.footnote, ""] : []),
    `Sent by ${agency} via ${BRAND.name} (${BRAND.site})`,
  ].join("\n");

  return { html, text };
}
