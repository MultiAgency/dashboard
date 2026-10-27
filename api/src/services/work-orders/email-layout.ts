export const BRAND = {
  name: "MultiAgency",
  site: "https://multiagency.ai",
  ink: "#0a0a0a",
  muted: "#737373",
  line: "#e5e5e5",
  page: "#fafafa",
  panel: "#f5f5f5",
  primary: "#fdc700",
  onPrimary: "#733e0a",
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

const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const HEADING = `Geist,${FONT}`;
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;font-size:14px;line-height:22px;color:${BRAND.ink}">${linkify(text)}</p>`;
}

function detailsTable(rows: [string, string][]): string {
  const cells = rows
    .map(
      ([label, value], index) =>
        `<tr><td style="padding:9px 12px;font-size:12px;line-height:18px;color:${BRAND.muted};white-space:nowrap;vertical-align:top;${index ? `border-top:1px solid ${BRAND.line};` : ""}">${escapeHtml(label)}</td><td style="padding:9px 12px;font-size:13px;line-height:18px;font-weight:500;color:${BRAND.ink};text-align:right;word-break:break-word;${index ? `border-top:1px solid ${BRAND.line};` : ""}">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${BRAND.line};margin:6px 0 22px">${cells}</table>`;
}

function listBlock(list: NonNullable<EmailContent["list"]>): string {
  const title = list.title
    ? `<p style="margin:0 0 6px;font-size:13px;font-weight:500;color:${BRAND.ink}">${escapeHtml(list.title)}</p>`
    : "";
  const items = list.items
    .map(
      (item) =>
        `<tr><td style="width:16px;vertical-align:top;padding:3px 0;font-size:13px;line-height:20px;color:${BRAND.muted}">&ndash;</td><td style="padding:3px 0;font-size:13px;line-height:20px;color:${BRAND.ink}">${linkify(item)}</td></tr>`,
    )
    .join("");
  return `${title}<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px">${items}</table>`;
}

function buttonCell(label: string, url: string, primary: boolean): string {
  const background = primary ? BRAND.primary : "#ffffff";
  const color = primary ? BRAND.onPrimary : BRAND.ink;
  const border = primary ? BRAND.primary : BRAND.line;
  return `<td style="background:${background};border:1px solid ${border}"><a href="${escapeHtml(url)}" style="display:inline-block;padding:9px 14px;font-family:${FONT};font-size:13px;line-height:18px;font-weight:500;color:${color};text-decoration:none">${escapeHtml(label)}${primary ? "&nbsp;&rarr;" : ""}</a></td>`;
}

function actions(
  action: EmailContent["action"],
  secondary: NonNullable<EmailContent["secondary"]>,
): string {
  const cells = [
    ...(action ? [buttonCell(action.label, action.url, true)] : []),
    ...secondary.map((link) => buttonCell(link.label, link.url, false)),
  ];
  if (cells.length === 0) return "";
  const row = cells.join(`<td style="width:8px;font-size:0">&nbsp;</td>`);
  const fallback = action
    ? `<p style="margin:0 0 22px;font-size:12px;line-height:18px;color:${BRAND.muted}">Or open this link: <a href="${escapeHtml(action.url)}" style="color:${BRAND.muted};word-break:break-all">${escapeHtml(action.url)}</a></p>`
    : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 ${action ? "12px" : "22px"}"><tr>${row}</tr></table>${fallback}`;
}

function reportBlock(block: NonNullable<EmailContent["block"]>): string {
  return `<p style="margin:6px 0 8px;font-size:13px;font-weight:500;color:${BRAND.ink}">${escapeHtml(block.title)}</p><div style="background:${BRAND.panel};border:1px solid ${BRAND.line};padding:12px 14px;margin:0 0 22px;font-family:${MONO};font-size:12px;line-height:19px;color:${BRAND.ink};white-space:pre-wrap;word-break:break-word">${linkify(clip(block.body))}</div>`;
}

export function renderEmail(content: EmailContent, agency: string): { html: string; text: string } {
  const body = [
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr><td style="border:1px solid ${BRAND.line};padding:2px 8px;font-size:12px;line-height:18px;font-weight:500;color:${BRAND.ink}">${escapeHtml(content.eyebrow)}</td></tr></table>`,
    `<h1 style="margin:0 0 18px;font-family:${HEADING};font-size:24px;line-height:30px;font-weight:600;letter-spacing:-0.5px;color:${BRAND.ink}">${escapeHtml(content.heading)}</h1>`,
    paragraph(content.greeting),
    ...content.paragraphs.map(paragraph),
    content.details?.length ? detailsTable(content.details) : "",
    content.list?.items.length ? listBlock(content.list) : "",
    actions(content.action ?? null, content.secondary ?? []),
    content.block?.body ? reportBlock(content.block) : "",
    content.footnote
      ? `<p style="margin:0 0 4px;font-size:12px;line-height:18px;color:${BRAND.muted}">${linkify(content.footnote)}</p>`
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
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${BRAND.line}">
<tr><td style="padding:16px 28px;border-bottom:1px solid ${BRAND.line}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle"><a href="${BRAND.site}" style="font-family:${HEADING};font-size:15px;font-weight:600;letter-spacing:-0.2px;color:${BRAND.ink};text-decoration:none">${BRAND.name}</a></td>
<td align="right" style="vertical-align:middle;font-size:12px;color:${BRAND.muted}">${escapeHtml(agency)}</td>
</tr></table>
</td></tr>
<tr><td style="padding:28px 28px 16px">${body}</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:16px 4px 0;font-size:12px;line-height:18px;color:${BRAND.muted}">Sent by ${escapeHtml(agency)} via <a href="${BRAND.site}" style="color:${BRAND.muted}">${BRAND.name}</a>. Open books for agency work.</td></tr>
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
