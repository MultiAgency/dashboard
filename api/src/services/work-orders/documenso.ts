export type EsignRole = "contractor" | "representative";

export type EsignBox = { page: number; x: number; y: number; width: number; height: number };

export type EsignSigner = {
  role: EsignRole;
  name: string;
  email: string;
  signature: EsignBox;
  date: EsignBox;
};

export type EsignStatus = {
  status: "pending" | "completed" | "rejected";
  completedAt: string | null;
  signers: {
    role: EsignRole;
    name: string;
    email: string;
    signedAt: string | null;
    rejected: boolean;
    rejectionReason: string | null;
  }[];
};

export type EsignPort = {
  send(input: {
    title: string;
    externalId: string;
    fileName: string;
    pdf: Uint8Array;
    subject: string;
    message: string;
    redirectUrl: string | null;
    signers: EsignSigner[];
  }): Promise<{ envelopeId: string; signingUrls: Partial<Record<EsignRole, string>> }>;
  status(envelopeId: string): Promise<EsignStatus>;
  downloadSigned(envelopeId: string): Promise<Uint8Array>;
  cancel(envelopeId: string, reason: string): Promise<void>;
};

type Envelope = {
  id: string;
  status: "DRAFT" | "PENDING" | "COMPLETED" | "REJECTED" | "CANCELLED";
  completedAt: string | null;
  recipients: {
    id: number;
    name: string;
    email: string;
    role: string;
    signingOrder: number | null;
    signingStatus: "NOT_SIGNED" | "SIGNED" | "REJECTED";
    signedAt: string | null;
    rejectionReason?: string | null;
  }[];
  envelopeItems?: { id: string; order: number }[];
};

export class DocumensoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DocumensoError";
  }
}

const ORDER: Record<EsignRole, number> = { representative: 1, contractor: 2 };

function roleOf(signingOrder: number | null, index: number): EsignRole {
  return (signingOrder ?? index + 1) <= ORDER.representative ? "representative" : "contractor";
}

export function createDocumenso(
  opts: { apiUrl?: string | null; apiKey: string },
  fetcher: typeof fetch = fetch,
): EsignPort {
  const base = `${(opts.apiUrl || "https://app.documenso.com").replace(/\/+$/, "")}/api/v2`;

  async function call(method: string, path: string, body?: FormData | object): Promise<Response> {
    const json = body !== undefined && !(body instanceof FormData);
    const response = await fetcher(`${base}${path}`, {
      method,
      headers: {
        Authorization: opts.apiKey,
        Accept: "application/json",
        ...(json ? { "Content-Type": "application/json" } : {}),
      },
      body: json ? JSON.stringify(body) : (body as FormData | undefined),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = "";
      try {
        const parsed = JSON.parse(text) as { message?: string };
        detail = parsed.message ? `: ${parsed.message}` : "";
      } catch {
        detail = text ? `: ${text.slice(0, 200)}` : "";
      }
      throw new DocumensoError(
        response.status,
        `Documenso ${method} ${path.split("?")[0]} answered ${response.status}${detail}`,
      );
    }
    return response;
  }

  const envelope = async (id: string) =>
    (await (await call("GET", `/envelope/${encodeURIComponent(id)}`)).json()) as Envelope;

  return {
    async send(input) {
      const form = new FormData();
      form.set(
        "payload",
        JSON.stringify({
          type: "DOCUMENT",
          title: input.title,
          externalId: input.externalId,
          recipients: input.signers.map((signer) => ({
            email: signer.email,
            name: signer.name,
            role: "SIGNER",
            signingOrder: ORDER[signer.role],
            fields: [
              {
                type: "SIGNATURE",
                page: signer.signature.page,
                positionX: signer.signature.x,
                positionY: signer.signature.y,
                width: signer.signature.width,
                height: signer.signature.height,
              },
              {
                type: "DATE",
                page: signer.date.page,
                positionX: signer.date.x,
                positionY: signer.date.y,
                width: signer.date.width,
                height: signer.date.height,
              },
            ],
          })),
          meta: {
            subject: input.subject,
            message: input.message,
            signingOrder: "SEQUENTIAL",
            distributionMethod: "NONE",
            ...(input.redirectUrl ? { redirectUrl: input.redirectUrl } : {}),
          },
        }),
      );
      form.append(
        "files",
        new Blob([Buffer.from(input.pdf)], { type: "application/pdf" }),
        input.fileName,
      );
      const created = (await (await call("POST", "/envelope/create", form)).json()) as {
        id: string;
      };
      const distributed = (await (
        await call("POST", "/envelope/distribute", {
          envelopeId: created.id,
          meta: { subject: input.subject, message: input.message, distributionMethod: "NONE" },
        })
      ).json()) as {
        recipients?: { email: string; signingOrder: number | null; signingUrl?: string }[];
      };
      const signingUrls: Partial<Record<EsignRole, string>> = {};
      for (const [index, recipient] of (distributed.recipients ?? []).entries()) {
        if (recipient.signingUrl) {
          signingUrls[roleOf(recipient.signingOrder, index)] = recipient.signingUrl;
        }
      }
      return { envelopeId: String(created.id), signingUrls };
    },

    async status(envelopeId) {
      const doc = await envelope(envelopeId);
      const signers = doc.recipients
        .filter((r) => r.role === "SIGNER")
        .sort((a, b) => (a.signingOrder ?? 0) - (b.signingOrder ?? 0) || a.id - b.id);
      return {
        status:
          doc.status === "COMPLETED"
            ? "completed"
            : doc.status === "REJECTED" || doc.status === "CANCELLED"
              ? "rejected"
              : "pending",
        completedAt: doc.completedAt,
        signers: signers.map((r, index) => ({
          role: roleOf(r.signingOrder, index),
          name: r.name,
          email: r.email,
          signedAt: r.signingStatus === "SIGNED" ? (r.signedAt ?? doc.completedAt) : null,
          rejected: r.signingStatus === "REJECTED",
          rejectionReason: r.rejectionReason ?? null,
        })),
      };
    },

    async cancel(envelopeId, reason) {
      await call("POST", "/envelope/cancel", { envelopeId, reason });
    },

    async downloadSigned(envelopeId) {
      const doc = await envelope(envelopeId);
      const item = [...(doc.envelopeItems ?? [])].sort((a, b) => a.order - b.order)[0];
      if (!item) throw new DocumensoError(404, "The Documenso document has no file");
      const response = await call(
        "GET",
        `/envelope/item/${encodeURIComponent(item.id)}/download?version=signed`,
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
        throw new DocumensoError(502, "Documenso didn't return a PDF for the signed document");
      }
      return bytes;
    },
  };
}
