import type {
  EsignPort,
  EsignRole,
  EsignSigner,
  EsignStatus,
} from "../../src/services/work-orders/documenso";

type Sent = {
  envelopeId: string;
  title: string;
  externalId: string;
  pdf: Uint8Array;
  subject: string;
  signers: EsignSigner[];
  status: EsignStatus["status"];
  signedAt: Partial<Record<EsignRole, string>>;
  rejectedBy: EsignRole | null;
};

export class FakeDocumenso implements EsignPort {
  sent: Sent[] = [];
  failSend: string | null = null;

  last(): Sent {
    const doc = this.sent.at(-1);
    if (!doc) throw new Error("fake documenso: nothing sent");
    return doc;
  }

  sign(role: EsignRole, at: string) {
    const doc = this.last();
    doc.signedAt[role] = at;
    if (doc.signedAt.contractor && doc.signedAt.representative) doc.status = "completed";
  }

  reject(role: EsignRole) {
    const doc = this.last();
    doc.rejectedBy = role;
    doc.status = "rejected";
  }

  async send(input: Parameters<EsignPort["send"]>[0]) {
    if (this.failSend) throw new Error(this.failSend);
    const envelopeId = `envelope_${this.sent.length + 1}`;
    this.sent.push({
      envelopeId,
      title: input.title,
      externalId: input.externalId,
      pdf: input.pdf,
      subject: input.subject,
      signers: input.signers,
      status: "pending",
      signedAt: {},
      rejectedBy: null,
    });
    return {
      envelopeId,
      signingUrls: {
        contractor: `https://sign.example/${envelopeId}/contractor`,
        representative: `https://sign.example/${envelopeId}/representative`,
      },
    };
  }

  async status(envelopeId: string): Promise<EsignStatus> {
    const doc = this.sent.find((d) => d.envelopeId === envelopeId);
    if (!doc) throw new Error(`fake documenso: no ${envelopeId}`);
    return {
      status: doc.status,
      completedAt: doc.status === "completed" ? (doc.signedAt.representative ?? null) : null,
      signers: doc.signers.map((s) => ({
        role: s.role,
        name: s.name,
        email: s.email,
        signedAt: doc.signedAt[s.role] ?? null,
        rejected: doc.rejectedBy === s.role,
        rejectionReason: doc.rejectedBy === s.role ? "Wrong budget" : null,
      })),
    };
  }

  async downloadSigned(envelopeId: string) {
    const doc = this.sent.find((d) => d.envelopeId === envelopeId);
    if (!doc || doc.status !== "completed") throw new Error("not completed");
    return new TextEncoder().encode(`%PDF-1.7 signed ${envelopeId} %%EOF`);
  }
}
