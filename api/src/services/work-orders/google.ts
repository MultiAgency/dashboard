import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
].join(" ");
const DRIVE = "https://www.googleapis.com/drive/v3";
const DOCS = "https://docs.googleapis.com/v1";
const TIMEOUT_MS = 20_000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

export type ServiceAccount = { clientEmail: string; privateKey: string; tokenUri: string };

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  createdTime: string | null;
  driveId: string | null;
};

export type DocRun = { segmentId: string | null; start: number; text: string };

export type GoogleDoc = { id: string; title: string; runs: DocRun[] };

export type GoogleAuth = {
  kind: "service_account" | "oauth";
  email: string;
  token(): Promise<string>;
};

export type GooglePort = {
  kind: "service_account" | "oauth";
  email: string;
  file(id: string): Promise<DriveFile>;
  copy(templateId: string, input: { name: string; parentId: string }): Promise<DriveFile>;
  fill(documentId: string, values: Record<string, string>): Promise<Record<string, number>>;
  read(documentId: string): Promise<GoogleDoc>;
  edit(documentId: string, requests: unknown[]): Promise<void>;
  listPdfs(folderId: string): Promise<DriveFile[]>;
  download(id: string): Promise<Uint8Array>;
  exportPdf(documentId: string): Promise<Uint8Array>;
  upload(input: {
    folderId: string;
    name: string;
    bytes: Uint8Array;
    mimeType: string;
    convertTo?: string;
  }): Promise<DriveFile>;
  uploadPdf(folderId: string, name: string, bytes: Uint8Array): Promise<DriveFile>;
};

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleError";
  }
}

export function readServiceAccount(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (text.startsWith("{")) return text;
  try {
    return readFileSync(text.replace(/^~(?=\/)/, homedir()), "utf8");
  } catch (error) {
    console.warn(
      `[API] GOOGLE_SERVICE_ACCOUNT_JSON: couldn't read ${text}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export function parseServiceAccount(raw: string | null | undefined): ServiceAccount | null {
  if (!raw?.trim()) return null;
  try {
    const value = JSON.parse(raw) as {
      client_email?: string;
      private_key?: string;
      token_uri?: string;
    };
    if (!value.client_email || !value.private_key) return null;
    return {
      clientEmail: value.client_email,
      privateKey: value.private_key.replace(/\\n/g, "\n"),
      tokenUri: value.token_uri ?? "https://oauth2.googleapis.com/token",
    };
  } catch {
    return null;
  }
}

export function googleIdOf(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const fromUrl =
    /\/(?:document|spreadsheets|presentation|file)\/d\/([A-Za-z0-9_-]{10,})/.exec(text)?.[1] ??
    /\/folders\/([A-Za-z0-9_-]{10,})/.exec(text)?.[1] ??
    /[?&]id=([A-Za-z0-9_-]{10,})/.exec(text)?.[1];
  if (fromUrl) return fromUrl;
  return /^[A-Za-z0-9_-]{10,}$/.test(text) ? text : null;
}

const base64url = (value: string | Buffer) =>
  Buffer.from(value).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

function fileOf(value: unknown): DriveFile {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    id: String(raw.id),
    name: String(raw.name ?? ""),
    mimeType: String(raw.mimeType ?? ""),
    webViewLink: typeof raw.webViewLink === "string" ? raw.webViewLink : null,
    createdTime: typeof raw.createdTime === "string" ? raw.createdTime : null,
    driveId: typeof raw.driveId === "string" ? raw.driveId : null,
  };
}

type DocElement = {
  startIndex?: number;
  paragraph?: { elements?: { startIndex?: number; textRun?: { content?: string } }[] };
  table?: { tableRows?: { tableCells?: { content?: DocElement[] }[] }[] };
  tableOfContents?: { content?: DocElement[] };
};

function runsOf(content: DocElement[] | undefined, segmentId: string | null, out: DocRun[]) {
  for (const element of content ?? []) {
    for (const part of element.paragraph?.elements ?? []) {
      const text = part.textRun?.content;
      if (text && typeof part.startIndex === "number") {
        out.push({ segmentId, start: part.startIndex, text });
      }
    }
    for (const row of element.table?.tableRows ?? []) {
      for (const cell of row.tableCells ?? []) runsOf(cell.content, segmentId, out);
    }
    runsOf(element.tableOfContents?.content, segmentId, out);
  }
}

export function docOf(id: string, value: unknown): GoogleDoc {
  const raw = (value ?? {}) as {
    title?: string;
    body?: { content?: DocElement[] };
    headers?: Record<string, { content?: DocElement[] }>;
    footers?: Record<string, { content?: DocElement[] }>;
    footnotes?: Record<string, { content?: DocElement[] }>;
  };
  const runs: DocRun[] = [];
  runsOf(raw.body?.content, null, runs);
  for (const group of [raw.headers, raw.footers, raw.footnotes]) {
    for (const [segmentId, segment] of Object.entries(group ?? {})) {
      runsOf(segment.content, segmentId, runs);
    }
  }
  return { id, title: raw.title ?? "", runs };
}

export function serviceAccountAuth(
  account: ServiceAccount,
  fetcher: typeof fetch = fetch,
): GoogleAuth {
  let cached: { token: string; expiresAt: number } | null = null;

  async function token(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = base64url(
      JSON.stringify({
        iss: account.clientEmail,
        scope: SCOPES,
        aud: account.tokenUri,
        iat: now,
        exp: now + 3600,
      }),
    );
    const signature = base64url(
      createSign("RSA-SHA256").update(`${header}.${claims}`).sign(account.privateKey),
    );
    const response = await fetcher(account.tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${header}.${claims}.${signature}`,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!response.ok || !body.access_token) {
      throw new GoogleError(
        `Google sign-in of the service account failed: ${body.error_description ?? response.status}`,
        response.status,
      );
    }
    cached = {
      token: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return cached.token;
  }

  return { kind: "service_account", email: account.clientEmail, token };
}

export function createGoogle(
  credentials: ServiceAccount | GoogleAuth,
  fetcher: typeof fetch = fetch,
): GooglePort {
  const auth = "privateKey" in credentials ? serviceAccountAuth(credentials, fetcher) : credentials;
  const serviceAccount = auth.kind === "service_account";

  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetcher(url, {
      ...init,
      headers: {
        authorization: `Bearer ${await auth.token()}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return response;
    const detail = (await response.json().catch(() => null)) as {
      error?: { message?: string; errors?: { reason?: string }[] };
    } | null;
    const message = (detail?.error?.message ?? `HTTP ${response.status}`).replace(/\.+$/, "");
    const reason = detail?.error?.errors?.[0]?.reason ?? "";
    if (serviceAccount && (reason === "storageQuotaExceeded" || /storage quota/i.test(message))) {
      throw new GoogleError(
        "The folder for the filled documents must be inside a Shared Drive: a service account has no Drive storage of its own, so it can't create files in someone's My Drive",
        response.status,
      );
    }
    throw new GoogleError(
      response.status === 404 || response.status === 403
        ? serviceAccount
          ? `${message}. Share it with ${auth.email}`
          : `${message}. Choose it again with the Google Drive picker so MultiAgency can open it`
        : message,
      response.status,
    );
  }

  const fields = "id,name,mimeType,webViewLink,createdTime,driveId";

  async function upload(input: Parameters<GooglePort["upload"]>[0]): Promise<DriveFile> {
    const boundary = `multiagency-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({
      name: input.name,
      parents: [input.folderId],
      ...(input.convertTo ? { mimeType: input.convertTo } : {}),
    });
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`,
      ),
      Buffer.from(input.bytes),
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    return fileOf(
      await (
        await call(
          `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=${fields}`,
          {
            method: "POST",
            body,
            headers: { "content-type": `multipart/related; boundary=${boundary}` },
          },
        )
      ).json(),
    );
  }

  return {
    kind: auth.kind,
    email: auth.email,

    file: async (id) =>
      fileOf(
        await (
          await call(
            `${DRIVE}/files/${encodeURIComponent(id)}?fields=${fields}&supportsAllDrives=true`,
          )
        ).json(),
      ),

    copy: async (templateId, input) =>
      fileOf(
        await (
          await call(
            `${DRIVE}/files/${encodeURIComponent(templateId)}/copy?fields=${fields}&supportsAllDrives=true`,
            {
              method: "POST",
              body: JSON.stringify({ name: input.name, parents: [input.parentId] }),
            },
          )
        ).json(),
      ),

    fill: async (documentId, values) => {
      const keys = Object.keys(values);
      const response = await call(
        `${DOCS}/documents/${encodeURIComponent(documentId)}:batchUpdate`,
        {
          method: "POST",
          body: JSON.stringify({
            requests: keys.map((key) => ({
              replaceAllText: {
                containsText: { text: `{{${key}}}`, matchCase: true },
                replaceText: values[key],
              },
            })),
          }),
        },
      );
      const body = (await response.json()) as {
        replies?: { replaceAllText?: { occurrencesChanged?: number } }[];
      };
      return Object.fromEntries(
        keys.map((key, i) => [key, body.replies?.[i]?.replaceAllText?.occurrencesChanged ?? 0]),
      );
    },

    read: async (documentId) =>
      docOf(
        documentId,
        await (
          await call(
            `${DOCS}/documents/${encodeURIComponent(documentId)}?fields=title,body,headers,footers,footnotes`,
          )
        ).json(),
      ),

    edit: async (documentId, requests) => {
      if (requests.length === 0) return;
      await call(`${DOCS}/documents/${encodeURIComponent(documentId)}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ requests }),
      });
    },

    listPdfs: async (folderId) => {
      const q = `'${folderId.replace(/'/g, "")}' in parents and mimeType='application/pdf' and trashed=false`;
      const out: DriveFile[] = [];
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          q,
          fields: `nextPageToken,files(${fields})`,
          orderBy: "createdTime",
          pageSize: "100",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
          ...(pageToken ? { pageToken } : {}),
        });
        const body = (await (await call(`${DRIVE}/files?${params}`)).json()) as {
          files?: Record<string, unknown>[];
          nextPageToken?: string;
        };
        out.push(...(body.files ?? []).map(fileOf));
        pageToken = body.nextPageToken;
      } while (pageToken && out.length < 1000);
      return out;
    },

    exportPdf: async (documentId) =>
      new Uint8Array(
        await (
          await call(
            `${DRIVE}/files/${encodeURIComponent(documentId)}/export?mimeType=application/pdf&supportsAllDrives=true`,
          )
        ).arrayBuffer(),
      ),

    upload,

    uploadPdf: (folderId, name, bytes) =>
      upload({ folderId, name, bytes, mimeType: "application/pdf" }),

    download: async (id) => {
      const response = await call(
        `${DRIVE}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`,
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_PDF_BYTES) {
        throw new GoogleError("The PDF is larger than 20 MB", 413);
      }
      return bytes;
    },
  };
}
