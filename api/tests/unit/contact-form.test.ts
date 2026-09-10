import { createHmac } from "node:crypto";
import { ORPCError } from "every-plugin/orpc";
import { describe, expect, test } from "vitest";
import {
  type ContactFormInput,
  serializeContactBody,
  signContactBody,
  submitContactForm,
} from "../../src/services/contact-form";

const input: ContactFormInput = {
  name: "Jane Doe",
  email: "jane@example.com",
  company: "Example Corp",
  message: "We want to build an AI agent on NEAR...",
};

const NOW_MS = 1_700_000_000_000;
const TIMESTAMP = Math.floor(NOW_MS / 1000);
const SECRET = "test-webhook-secret";
const URL = "http://127.0.0.1:8644/webhooks/contact-form";

function expectedSignature(body: string): string {
  return createHmac("sha256", SECRET).update(`${TIMESTAMP}.${body}`).digest("hex");
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("serializeContactBody", () => {
  test("uses compact JSON with event_type, not event", () => {
    expect(serializeContactBody(input)).toBe(
      '{"event_type":"submission","payload":{"name":"Jane Doe","email":"jane@example.com","company":"Example Corp","message":"We want to build an AI agent on NEAR..."}}',
    );
  });

  test("sends empty strings for omitted company and message", () => {
    const parsed = JSON.parse(serializeContactBody({ name: "Ada", email: "ada@example.com" })) as {
      payload: { company: string; message: string };
    };
    expect(parsed.payload.company).toBe("");
    expect(parsed.payload.message).toBe("");
  });
});

describe("submitContactForm", () => {
  test("POSTs HMAC-SHA256 V2 headers and signed body", async () => {
    const calls: Array<[string | URL | Request, RequestInit | undefined]> = [];
    const result = await submitContactForm(input, {
      webhookUrl: URL,
      webhookSecret: SECRET,
      now: () => NOW_MS,
      fetchImpl: async (url, init) => {
        calls.push([url, init]);
        return jsonResponse(202, {
          status: "accepted",
          route: "contact-form",
          event: "submission",
          delivery_id: "del_123",
        });
      },
    });

    expect(result).toEqual({ status: "accepted", deliveryId: "del_123" });
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] ?? [];
    expect(url).toBe(URL);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    const body = String(init?.body);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Webhook-Timestamp"]).toBe(String(TIMESTAMP));
    expect(headers["X-Webhook-Signature-V2"]).toBe(expectedSignature(body));
    expect(headers["X-Webhook-Signature-V2"]).toBe(signContactBody(SECRET, TIMESTAMP, body));
    expect(body).not.toContain(SECRET);
    expect(JSON.stringify(headers)).not.toContain(SECRET);
  });

  test("fails closed when url or secret is missing or blank", async () => {
    await expect(submitContactForm(input, {})).rejects.toBeInstanceOf(ORPCError);
    await expect(
      submitContactForm(input, { webhookUrl: URL, webhookSecret: "   " }),
    ).rejects.toMatchObject({ message: "Contact form is currently unavailable" });
    await expect(
      submitContactForm(input, { webhookUrl: "  ", webhookSecret: SECRET }),
    ).rejects.toMatchObject({ message: "Contact form is currently unavailable" });
  });

  test("treats 401 and ignored 200 as send failures without leaking status details", async () => {
    await expect(
      submitContactForm(input, {
        webhookUrl: URL,
        webhookSecret: SECRET,
        now: () => NOW_MS,
        fetchImpl: async () => jsonResponse(401, { error: "Invalid signature" }),
      }),
    ).rejects.toMatchObject({ message: "Failed to send message" });

    await expect(
      submitContactForm(input, {
        webhookUrl: URL,
        webhookSecret: SECRET,
        now: () => NOW_MS,
        fetchImpl: async () => jsonResponse(200, { status: "ignored", event: "unknown" }),
      }),
    ).rejects.toMatchObject({ message: "Failed to send message" });
  });

  test("treats network errors as send failures", async () => {
    await expect(
      submitContactForm(input, {
        webhookUrl: URL,
        webhookSecret: SECRET,
        now: () => NOW_MS,
        fetchImpl: async () => {
          throw new Error("network down");
        },
      }),
    ).rejects.toMatchObject({ message: "Failed to send message" });
  });
});
