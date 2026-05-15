import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { type ApplicationNotification, notifyNewApplication } from "../src/services/notify";

const ok = (status = 200): Response =>
  new Response("{}", { status, headers: { "Content-Type": "application/json" } });

const fail = (status = 500): Response =>
  new Response("error", { status, headers: { "Content-Type": "text/plain" } });

const sampleApp: ApplicationNotification = {
  id: "test-id-1",
  kind: "contributor",
  name: "Ada",
  email: "ada@example.com",
  nearAccountId: "ada.near",
  message: "hi",
};

describe("notifyNewApplication", () => {
  const originalFetch = globalThis.fetch;
  let calls: Array<[string | URL | Request, RequestInit | undefined]>;
  let queue: Array<() => Promise<Response>>;

  beforeEach(() => {
    calls = [];
    queue = [];
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      calls.push([url, init]);
      const next = queue.shift();
      if (!next) throw new Error("unexpected fetch call (queue empty)");
      return next();
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const enqueueOk = () => queue.push(async () => ok());
  const enqueueFail = () => queue.push(async () => fail());
  const enqueueThrow = () =>
    queue.push(async () => {
      throw new Error("network down");
    });

  test("no-op when no channels configured (no fetch calls)", async () => {
    await notifyNewApplication(sampleApp, {});
    expect(calls).toHaveLength(0);
  });

  test("webhook fires with { content, text, application } payload", async () => {
    enqueueOk();
    await notifyNewApplication(sampleApp, { webhookUrl: "https://hook.example/abc" });

    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] ?? [];
    expect(url).toBe("https://hook.example/abc");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string) as {
      content: string;
      text: string;
      application: ApplicationNotification;
    };
    expect(body.content).toBe(body.text);
    expect(body.content).toContain("contributor");
    expect(body.content).toContain("Ada");
    expect(body.content).toContain("ada@example.com");
    expect(body.application).toMatchObject({
      id: "test-id-1",
      kind: "contributor",
      name: "Ada",
      email: "ada@example.com",
    });
  });

  test("email fires (POST api.resend.com/emails, bearer header) when fully configured", async () => {
    enqueueOk();
    await notifyNewApplication(sampleApp, {
      resendApiKey: "re_test",
      fromEmail: "notify@example.com",
      contactEmail: "agency@example.com",
    });

    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(init?.body as string) as {
      from: string;
      to: string;
      subject: string;
      html: string;
    };
    expect(body.from).toBe("notify@example.com");
    expect(body.to).toBe("agency@example.com");
    expect(body.subject).toContain("contributor");
    expect(body.subject).toContain("Ada");
    expect(body.html).toContain("ada@example.com");
  });

  test("email skipped when any of resendApiKey / fromEmail / contactEmail missing", async () => {
    await notifyNewApplication(sampleApp, {
      resendApiKey: "re_test",
      fromEmail: "notify@example.com",
    });
    expect(calls).toHaveLength(0);

    await notifyNewApplication(sampleApp, {
      resendApiKey: "re_test",
      contactEmail: "agency@example.com",
    });
    expect(calls).toHaveLength(0);
  });

  test("both channels fire in parallel when both configured", async () => {
    enqueueOk();
    enqueueOk();
    await notifyNewApplication(sampleApp, {
      webhookUrl: "https://hook.example/abc",
      resendApiKey: "re_test",
      fromEmail: "notify@example.com",
      contactEmail: "agency@example.com",
    });
    expect(calls).toHaveLength(2);
    const urls = calls.map(([u]) => String(u)).sort();
    expect(urls).toEqual(["https://api.resend.com/emails", "https://hook.example/abc"]);
  });

  test("one channel failing does not prevent the other; never throws", async () => {
    enqueueFail();
    enqueueOk();
    await expect(
      notifyNewApplication(sampleApp, {
        webhookUrl: "https://hook.example/abc",
        resendApiKey: "re_test",
        fromEmail: "notify@example.com",
        contactEmail: "agency@example.com",
      }),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  test("fetch throwing on one channel does not throw from notify", async () => {
    enqueueThrow();
    enqueueOk();
    await expect(
      notifyNewApplication(sampleApp, {
        webhookUrl: "https://hook.example/abc",
        resendApiKey: "re_test",
        fromEmail: "notify@example.com",
        contactEmail: "agency@example.com",
      }),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  test("html email body escapes < > & in user-controlled fields", async () => {
    enqueueOk();
    await notifyNewApplication(
      { ...sampleApp, name: "<script>alert(1)</script>", message: "a & b" },
      {
        resendApiKey: "re_test",
        fromEmail: "notify@example.com",
        contactEmail: "agency@example.com",
      },
    );
    const body = JSON.parse((calls[0]?.[1]?.body as string) ?? "{}") as { html: string };
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("a &amp; b");
  });
});
