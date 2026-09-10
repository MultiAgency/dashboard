import { createHmac } from "node:crypto";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { fetchWithTimeout } from "./fetch";

export type ContactFormInput = {
  name: string;
  email: string;
  company?: string;
  message?: string;
};

export type ContactFormConfig = {
  webhookUrl?: string;
  webhookSecret?: string;
  now?: () => number;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
};

export type ContactFormResult = {
  status: "accepted";
  deliveryId?: string;
};

const UNAVAILABLE = "Contact form is currently unavailable";
const SEND_FAILED = "Failed to send message";

export function configuredValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function serializeContactBody(input: ContactFormInput): string {
  return JSON.stringify({
    event_type: "submission",
    payload: {
      name: input.name,
      email: input.email,
      company: input.company ?? "",
      message: input.message ?? "",
    },
  });
}

export function signContactBody(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export async function submitContactForm(
  input: ContactFormInput,
  config: ContactFormConfig,
): Promise<ContactFormResult> {
  const webhookUrl = configuredValue(config.webhookUrl);
  const webhookSecret = configuredValue(config.webhookSecret);
  if (!webhookUrl || !webhookSecret) {
    console.warn("[API] contact form webhook is not configured");
    throw new ORPCError("INTERNAL_SERVER_ERROR", { message: UNAVAILABLE });
  }

  const body = serializeContactBody(input);
  const timestamp = Math.floor((config.now ?? Date.now)() / 1000);
  const signature = signContactBody(webhookSecret, timestamp, body);
  const fetchImpl = config.fetchImpl ?? fetchWithTimeout;

  let res: Response;
  try {
    res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Timestamp": String(timestamp),
        "X-Webhook-Signature-V2": signature,
      },
      body,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : error;
    console.warn("[API] contact form webhook failed:", reason);
    throw new ORPCError("INTERNAL_SERVER_ERROR", { message: SEND_FAILED });
  }

  if (res.status === 202) {
    const deliveryId = await readDeliveryId(res);
    return deliveryId ? { status: "accepted", deliveryId } : { status: "accepted" };
  }

  console.warn("[API] contact form webhook failed:", res.status);
  throw new ORPCError("INTERNAL_SERVER_ERROR", { message: SEND_FAILED });
}

async function readDeliveryId(res: Response): Promise<string | undefined> {
  try {
    const json: unknown = await res.json();
    if (
      json &&
      typeof json === "object" &&
      "delivery_id" in json &&
      typeof json.delivery_id === "string" &&
      json.delivery_id.length > 0
    ) {
      return json.delivery_id;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function createContactFormService(config: ContactFormConfig) {
  return {
    submit: (input: ContactFormInput) =>
      Effect.tryPromise({
        try: () => submitContactForm(input, config),
        catch: (error) => {
          if (error instanceof ORPCError) return error;
          return new ORPCError("INTERNAL_SERVER_ERROR", { message: SEND_FAILED });
        },
      }),
  };
}

export type ContactFormService = ReturnType<typeof createContactFormService>;
