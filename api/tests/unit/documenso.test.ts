import { describe, expect, test } from "vitest";
import { createDocumenso } from "../../src/services/work-orders/documenso";

function documensoWith(recipients: { email: string; order: number; signed: boolean }[]) {
  const fetcher = (async () =>
    new Response(
      JSON.stringify({
        id: "env_1",
        status: "PENDING",
        completedAt: null,
        recipients: recipients.map((r, index) => ({
          id: index + 1,
          name: r.email.split("@")[0],
          email: r.email,
          role: "SIGNER",
          signingOrder: r.order,
          signingStatus: r.signed ? "SIGNED" : "NOT_SIGNED",
          signedAt: r.signed ? "2026-10-20T10:00:00.000Z" : null,
        })),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as unknown as typeof fetch;
  return createDocumenso({ apiUrl: "https://sign.example", apiKey: "key" }, fetcher);
}

describe("documenso status", () => {
  test("envelopes sent with the agency first read order 1 as the representative", async () => {
    const documenso = documensoWith([
      { email: "rita@studio.example", order: 1, signed: true },
      { email: "carol@example.com", order: 2, signed: false },
    ]);
    const state = await documenso.status("env_1", { representativeFirst: true });
    expect(state.signers.map((s) => [s.role, s.email, !!s.signedAt])).toEqual([
      ["representative", "rita@studio.example", true],
      ["contractor", "carol@example.com", false],
    ]);
  });

  test("envelopes sent before the agency signed first still read the builder at order 1", async () => {
    const documenso = documensoWith([
      { email: "carol@example.com", order: 1, signed: true },
      { email: "rita@studio.example", order: 2, signed: false },
    ]);
    const state = await documenso.status("env_1", { representativeFirst: false });
    expect(state.signers.map((s) => [s.role, s.email, !!s.signedAt])).toEqual([
      ["contractor", "carol@example.com", true],
      ["representative", "rita@studio.example", false],
    ]);
  });
});
