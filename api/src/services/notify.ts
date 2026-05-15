import { fetchWithTimeout } from "./fetch";

export type ApplicationNotification = {
  id: string;
  kind: "founder" | "contributor" | "client";
  name: string;
  email: string;
  nearAccountId: string | null;
  message: string | null;
};

export type NotifyConfig = {
  webhookUrl?: string;
  resendApiKey?: string;
  fromEmail?: string;
  contactEmail?: string | null;
};

export async function notifyNewApplication(
  app: ApplicationNotification,
  config: NotifyConfig,
): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (config.webhookUrl) {
    tasks.push(sendWebhook(config.webhookUrl, app));
  }
  if (config.resendApiKey && config.fromEmail && config.contactEmail) {
    tasks.push(
      sendResendEmail(
        {
          resendApiKey: config.resendApiKey,
          fromEmail: config.fromEmail,
          contactEmail: config.contactEmail,
        },
        app,
      ),
    );
  }
  if (tasks.length === 0) return;
  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === "rejected") {
      const reason = r.reason as Error | undefined;
      console.warn("[API] application notification failed:", reason?.message ?? reason);
    }
  }
}

function summary(app: ApplicationNotification): string {
  return `New ${app.kind} message from ${app.name} (${app.email})`;
}

async function sendWebhook(url: string, app: ApplicationNotification): Promise<void> {
  const text = summary(app);
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text, text, application: app }),
  });
  if (!res.ok) {
    throw new Error(`webhook POST failed: ${res.status}`);
  }
}

async function sendResendEmail(
  config: { resendApiKey: string; fromEmail: string; contactEmail: string },
  app: ApplicationNotification,
): Promise<void> {
  const subject = `New ${app.kind} message — ${app.name}`;
  const html = renderEmailHtml(app);
  const res = await fetchWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.resendApiKey}`,
    },
    body: JSON.stringify({
      from: config.fromEmail,
      to: config.contactEmail,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    throw new Error(`resend POST failed: ${res.status}`);
  }
}

function renderEmailHtml(app: ApplicationNotification): string {
  const esc = (s: string | null): string =>
    s === null ? "—" : s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<p>New <strong>${esc(app.kind)}</strong> message received.</p>
<ul>
<li><strong>Name:</strong> ${esc(app.name)}</li>
<li><strong>Email:</strong> ${esc(app.email)}</li>
<li><strong>NEAR account:</strong> ${esc(app.nearAccountId)}</li>
<li><strong>Message:</strong> ${esc(app.message)}</li>
</ul>
<p>Review in the Applications section on <code>/team</code>.</p>`;
}
